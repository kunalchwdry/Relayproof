"""Browser test for the video analysis page.

Usage:
  RELAYPROOF_VIDEO=/path/clip.mp4 python3 test/e2e/analyze-browser.py

Environment:
  RELAYPROOF_URL     page to test (default http://localhost:5173/)
  RELAYPROOF_VIDEO   video to upload (required)
  RELAYPROOF_TRANSCRIPT  text to type into the transcript box. Leave unset to test in-browser speech.
  RELAYPROOF_LIVE=1  send frames and text to the real NVIDIA routes. Off by default: the routes are mocked,
                     so no frames leave the machine. Turning it on is a real send, one run per decision.

Exits non-zero if the page throws, shows an error, or never finishes.
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
TRANSCRIPT = os.environ.get('RELAYPROOF_TRANSCRIPT')

if not VIDEO:
    sys.exit('set RELAYPROOF_VIDEO to a video file')

seen = {'frames_requests': 0, 'text_requests': 0}


def mock(route):
    body = json.loads(route.request.post_data or '{}')
    if 'analyze-frames' in route.request.url:
        seen['frames_requests'] += 1
        frames = [{'timestampSeconds': f['timestampSeconds'], 'onScreenText': '', 'issues': [], 'parsed': True} for f in body.get('frames', [])]
        if seen['frames_requests'] == 2 and frames:  # one fake finding, so the pop-up path is exercised
            frames[0]['issues'] = [{'category': 'scam_or_fraud', 'severity': 'high', 'description': 'MOCK finding for the UI test'}]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'frames': frames}))
    elif 'analyze-text' in route.request.url:
        seen['text_requests'] += 1
        seen['transcript_chars'] = len(body.get('transcript', ''))
        route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'safety': {'status': 'safe', 'categories': []}, 'liveSearch': False,
            'schemeFlags': [{'flag': 'Guaranteed returns', 'quote': 'MOCK'}] if 'MOCK' in json.dumps(body) else [], 'claims': []}))
    else:
        route.continue_()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if not LIVE:
            page.route('**/api/nim/**', mock)
        page.goto(URL, wait_until='networkidle', timeout=90000)
        page.get_by_role('button', name='Analyse video').first.click()
        page.wait_for_timeout(800)
        page.locator('section.analyze-view input[type=file]').first.set_input_files(VIDEO)
        page.locator('.analyze-meta').wait_for(timeout=120000)
        page.wait_for_timeout(1000)
        if TRANSCRIPT is not None and TRANSCRIPT != '':
            page.locator('textarea.analyze-transcript').fill(TRANSCRIPT)
        page.get_by_role('button', name='Analyse this clip').click()

        last, started = '', time.time()
        while time.time() - started < 1500:
            if page.locator('.analyze-summary').count() or page.locator('.inline-error').count():
                break
            current = (page.locator('.analyze-progress').all_inner_texts() or [''])[0]
            if current and current != last:
                print(f'[{int(time.time() - started)}s] {current}', flush=True)
                last = current
            page.wait_for_timeout(1500)
        page.wait_for_timeout(800)

        failed = False
        if page.locator('.inline-error').count():
            print('ERROR:', page.locator('.inline-error').all_inner_texts())
            failed = True
        if page.locator('.analyze-summary').count():
            print('SUMMARY:', page.locator('.analyze-summary').inner_text().replace('\n', ' | '))
        else:
            failed = True
        print('POPUP:', 'shown' if page.locator('.alert-dialog').count() else 'none')
        cards = page.locator('.analyze-cards .result-block')
        for i in range(cards.count()):
            text = cards.nth(i).inner_text()
            if 'SPOKEN WORDS' in text:
                print('SPOKEN WORDS:', text.replace('\n', ' | ')[:800])
        print('REQUESTS:', seen)
        if errors:
            print('PAGE ERRORS:', errors)
            failed = True
        browser.close()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
