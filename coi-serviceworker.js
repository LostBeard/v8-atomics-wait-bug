/*! coi-serviceworker - Cross-Origin Isolation via Service Worker */
/*
 * Adds Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
 * to enable SharedArrayBuffer on static hosts like GitHub Pages.
 *
 * Usage: <script src="coi-serviceworker.js"></script>
 */

if (typeof window !== 'undefined') {
    // --- Page context ---
    if (window.crossOriginIsolated) {
        // Already isolated, nothing to do
    } else if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(window.document.currentScript.src)
            .then(function (reg) {
                console.log('[COI] Service worker registered, scope:', reg.scope);
                // Reload once active so the SW can inject headers
                navigator.serviceWorker.ready.then(function () {
                    window.location.reload();
                });
            })
            .catch(function (err) {
                console.error('[COI] Service worker registration failed:', err);
            });
    }
} else {
    // --- Service Worker context ---
    self.addEventListener('install', function () { self.skipWaiting(); });
    self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

    self.addEventListener('fetch', function (event) {
        if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
            return;
        }
        var url = new URL(event.request.url);
        if (url.origin !== self.location.origin) {
            return;
        }
        event.respondWith(
            fetch(event.request).then(function (response) {
                var newHeaders = new Headers(response.headers);
                newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
                newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            }).catch(function (e) {
                console.error('[COI] Fetch failed:', event.request.url, e.message);
                return new Response('Service Worker fetch failed', { status: 502 });
            })
        );
    });
}
