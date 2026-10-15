"""Browser test for the video analysis page.

Usage:
  RELAYPROOF_VIDEO=/path/clip.mp4 python3 test/e2e/analyze-browser.py

Environment:
  RELAYPROOF_URL          page to test (default http://localhost:5173/)
  RELAYPROOF_VIDEO        video to upload (required)
  RELAYPROOF_TRANSCRIPT   text to type into the transcript box. Ignored when RELAYPROOF_SILENT=1.
  RELAYPROOF_SILENT=1     the clip has no sound track: tick speech, expect the no-sound-track message, and skip the transcript.
  RELAYPROOF_LIVE=1       send frames and text to the real NVIDIA routes. Off by default: the routes are mocked, so no
                          frames leave the machine. Turning it on is a real send, one run per decision.

Checks (mocked NVIDIA by default):
  1. Cancel stops a running analysis: no results appear, and the page is ready to analyse again.
  2. A full run shows the summary, the Content Credentials card, and the pop-up.
  3. The pop-up is keyboard-operable: focus moves in, Escape closes it, focus returns to the control that opened it.
  4. Export report downloads a JSON report with findings and no frame pictures.
  5. (RELAYPROOF_SILENT=1) a clip with no sound track is reported as such, and the speech model is never loaded.
  6. (RELAYPROOF_NIM_DOWN=1) when NVIDIA is unavailable, the page says so in plain words and shows no results.
  7. (RELAYPROOF_BLANK=1) a clip whose frames come out black (for example an undecodable codec) is stopped before any frame is sent.

Exits non-zero if the page throws, shows an unexpected error, or a check fails.
Needs: pip install playwright && python -m playwright install chromium
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = os.environ.get('RELAYPROOF_URL', 'http://localhost:5173/')
VIDEO = os.environ.get('RELAYPROOF_VIDEO')
LIVE = os.environ.get('RELAYPROOF_LIVE') == '1'
SILENT = os.environ.get('RELAYPROOF_SILENT') == '1'
NIM_DOWN = os.environ.get('RELAYPROOF_NIM_DOWN') == '1'
BLANK = os.environ.get('RELAYPROOF_BLANK') == '1'
TRANSCRIPT = os.environ.get('RELAYPROOF_TRANSCRIPT')

if not VIDEO:
    sys.exit('set RELAYPROOF_VIDEO to a video file')

seen = {'frames_requests': 0, 'text_requests': 0, 'speech_model_requests': 0}
failures = []


def check(condition, message):
    print(('PASS ' if condition else 'FAIL ') + message, flush=True)
    if not condition:
        failures.append(message)


def mock(route):
    url = route.request.url
    body = json.loads(route.request.post_data or '{}')
    if NIM_DOWN and ('analyze-frames' in url or 'analyze-text' in url):
        route.fulfill(status=503, content_type='application/json', body='{"detail":"NVIDIA NIM is not configured on the server (NVIDIA_API_KEY is missing)."}')
        return
    if 'analyze-frames' in url:
        seen['frames_requests'] += 1
        frames = [{'timestampSeconds': f['timestampSeconds'], 'onScreenText': '', 'issues': [], 'parsed': True} for f in body.get('frames', [])]
        if frames:  # one fake finding per batch, so the pop-up path always runs
            frames[0]['issues'] = [{'category': 'scam_or_fraud', 'severity': 'high', 'description': 'MOCK finding for the UI test'}]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'frames': frames}))
    elif 'analyze-text' in url:
        seen['text_requests'] += 1
        seen['transcript_chars'] = len(body.get('transcript', ''))
        route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'safety': {'status': 'safe', 'categories': []}, 'liveSearch': False,
            'schemeFlags': [{'flag': 'Guaranteed returns', 'quote': 'MOCK'}] if 'MOCK' in json.dumps(body) else [],
            'claims': [{'claim': 'Water boils at 90 C at sea level', 'verdict': 'contradicted', 'reason': 'MOCK reason',
                        'logicIssue': None, 'evidenceSource': 'factcheck', 'evidenceLabel': 'MOCK fact checks',
                        'searchUsed': True, 'searchError': None, 'sources': [{'title': 'MOCK source', 'link': 'https://example.org/mock'}]}],
        }))
    else:
        route.fulfill(status=404, content_type='application/json', body='{"detail":"not mocked"}')


def block_speech_model(route):
    seen['speech_model_requests'] += 1
    route.abort()


def load_clip(page):
    page.get_by_role('button', name='Analyse video').first.click()
    page.wait_for_timeout(800)
    page.locator('section.analyze-view input[type=file]').first.set_input_files(VIDEO)
    page.locator('.analyze-meta').wait_for(timeout=120000)
    page.wait_for_timeout(1000)


def wait_for_result_or_error(page, timeout_s=600):
    started = time.time()
    last = ''
    while time.time() - started < timeout_s:
        if page.locator('.analyze-summary').count() or page.locator('.inline-error').count():
            break
        current = (page.locator('.analyze-progress').all_inner_texts() or [''])[0]
        if current and current != last:
            print(f'[{int(time.time() - started)}s] {current}', flush=True)
            last = current
        page.wait_for_timeout(1000)
    page.wait_for_timeout(600)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if not LIVE:
            page.route('**/api/nim/**', mock)
        if SILENT:
            page.route('**/huggingface.co/**', block_speech_model)
            page.route('**/*.huggingface.co/**', block_speech_model)
        page.goto(URL, wait_until='networkidle', timeout=90000)
        load_clip(page)

        if BLANK:
            page.get_by_role('button', name='Analyse this clip').click()
            wait_for_result_or_error(page, timeout_s=240)
            message = page.locator('.inline-error').all_inner_texts()
            check(any('came out black' in m for m in message), f'blank picture: a plain message is shown ({message[:1]})')
            check(seen['frames_requests'] == 0, 'blank picture: no frame was sent to NVIDIA')
            check(page.locator('.analyze-summary').count() == 0, 'blank picture: no results are shown')
            report_summary(page, errors)
            browser.close()
            return finish(errors)

        if NIM_DOWN:
            page.get_by_role('button', name='Analyse this clip').click()
            wait_for_result_or_error(page, timeout_s=240)
            message = page.locator('.inline-error').all_inner_texts()
            check(any('not available' in m for m in message), f'NVIDIA down: a plain message is shown ({message[:1]})')
            check(page.locator('.analyze-summary').count() == 0, 'NVIDIA down: no results are shown')
            check(page.get_by_role('button', name='Analyse this clip').is_enabled(), 'NVIDIA down: the page is ready to try again')
            report_summary(page, errors)
            browser.close()
            return finish(errors)

        if SILENT:
            page.locator('.analyze-speech-toggle input[type=checkbox]').check()
            check(page.get_by_text('This clip has no sound track.').count() > 0, 'the page says the clip has no sound track before analysis')
            page.get_by_role('button', name='Analyse this clip').click()
            wait_for_result_or_error(page)
            cards = page.locator('.analyze-cards .result-block')
            spoken = next((cards.nth(i).inner_text() for i in range(cards.count()) if 'SPOKEN WORDS' in cards.nth(i).inner_text()), '')
            check('no sound track' in spoken, 'SPOKEN WORDS reports there is no sound track')
            check(seen['speech_model_requests'] == 0, 'the speech model was not downloaded for a silent clip')
            check(page.locator('.inline-error').count() == 0, 'no error is shown for a silent clip')
            report_summary(page, errors)
            browser.close()
            return finish(errors)

        # 1. Cancel: start, then cancel while it is running.
        page.get_by_role('button', name='Analyse this clip').click()
        cancel = page.get_by_role('button', name='Cancel analysis')
        cancel.wait_for(timeout=30000)
        cancel.click()
        page.wait_for_timeout(2500)
        check(page.locator('.analyze-summary').count() == 0, 'cancel: no results appear after cancelling')
        check(page.get_by_role('button', name='Analyse this clip').is_enabled(), 'cancel: the page is ready to analyse again')
        check(page.locator('.analyze-progress').count() == 0, 'cancel: no progress message is left behind')

        # 2. A full run.
        if TRANSCRIPT:
            page.locator('textarea.analyze-transcript').fill(TRANSCRIPT)
        page.get_by_role('button', name='Analyse this clip').click()
        wait_for_result_or_error(page)
        check(page.locator('.inline-error').count() == 0, 'full run: no error is shown')
        check(page.locator('.analyze-summary').count() == 1, 'full run: the summary appears')
        cards = page.locator('.analyze-cards .result-block')
        titles = [cards.nth(i).locator('.section-kicker').inner_text() for i in range(cards.count())]
        check('CONTENT CREDENTIALS (C2PA)' in titles, 'full run: the Content Credentials card is shown')
        check(any('CLAIMS' in t for t in titles), 'full run: the claims card is shown')
        check(page.locator('.alert-dialog').count() == 1, 'full run: the pop-up opens for a high-priority finding')
        check(page.get_by_text('Checked against: MOCK fact checks').count() > 0, 'claims: the evidence source is shown')
        check(page.locator('.frame-thumb').count() >= 1 and page.get_by_role('link', name='Download frame').count() >= 1, 'frame log: thumbnails and download links are shown')

        # 3. Keyboard: focus is inside the pop-up, Tab stays in it, Escape closes it and returns focus.
        inside = page.evaluate("() => !!document.activeElement.closest('.alert-dialog')")
        check(inside, 'pop-up: focus moves inside when it opens')
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        still_inside = page.evaluate("() => !!document.activeElement.closest('.alert-dialog')")
        check(still_inside, 'pop-up: Tab stays inside the dialog')
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        check(page.locator('.alert-dialog').count() == 0, 'pop-up: Escape closes it')
        focus_is_page = page.evaluate("() => !!document.activeElement && document.activeElement !== document.body")
        check(focus_is_page, 'pop-up: focus returns to the page after Escape (not lost to the body)')
        page.get_by_role('button', name='Show alerts again').focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        check(page.locator('.alert-dialog').count() == 1, 'pop-up: Enter on "Show alerts again" reopens it')
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        focus_label = page.evaluate("() => (document.activeElement && document.activeElement.textContent || '').trim()")
        check('Show alerts again' in (focus_label or ''), f'pop-up: focus returns to the button that opened it (now on "{focus_label}")')

        # 4. Export the report.
        with page.expect_download(timeout=30000) as download_info:
            page.get_by_role('button', name='Export report (JSON)').click()
        download = download_info.value
        path = download.path()
        report = json.loads(open(path, encoding='utf-8').read())
        check(report.get('reportVersion') == 1, 'report: downloads as a versioned JSON file')
        check(len(report.get('frames', [])) >= 1 and any(a.get('title') for a in report.get('alerts', [])), 'report: includes frames and alerts with times')
        check('data:image' not in json.dumps(report), 'report: contains no frame pictures')
        check(download.suggested_filename.startswith('relayproof-') and download.suggested_filename.endswith('.json'), f'report: file name is {download.suggested_filename}')

        report_summary(page, errors)
        browser.close()
        finish(errors)


def report_summary(page, errors):
    print('SUMMARY:', page.locator('.analyze-summary').inner_text().replace('\n', ' | ') if page.locator('.analyze-summary').count() else 'none', flush=True)
    print('REQUESTS:', seen, flush=True)
    if errors:
        print('PAGE ERRORS:', errors, flush=True)
        failures.append('page errors')


def finish(errors):
    if errors:
        failures.append('page errors')
    print('RESULT:', 'PASS' if not failures else 'FAIL: ' + '; '.join(failures), flush=True)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
