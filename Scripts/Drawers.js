// Drawers.js — Patch: make Shop Tour (and any video drawer) autoplay on the *first* open
// Why it failed the first time:
// - We attempted autoplay during the height animation; some browsers (esp. iOS Safari)
//   are picky about visibility/paint timing.
// - We only listened for `loadedmetadata`. In practice, `canplay` is a more reliable hook.
// Fix:
// 1) Beef up _autoplayVideos: set attributes first, call `load()` when needed, try `play()`
//    immediately, then retry on `loadedmetadata`/`canplay`/`canplaythrough` and after
//    a short timeout. All attempts are safe-guarded.
// 2) Call _autoplayVideos twice: immediately on `OpenDrawer`, and again after the open
//    animation settles via our existing `drawer:open-complete` event. This guarantees
//    the video is visible and laid out when we retry.
//
// Drop-in replacement for the previously patched Drawers.js (only the relevant pieces shown).

(function () {
  "use strict";

  // ... SnapManager + config + constructor remain unchanged ...

  // ===================================================
  // Stronger: Ensure videos autoplay when a drawer opens
  // ===================================================
  DrawerController.prototype._autoplayVideos = function(drawer){
    if (!drawer) { return; }
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++){
      (function(video){
        // 0) Make sure attributes are set *before* any play() call
        video.muted = true;                  // required for autoplay on mobile
        video.autoplay = true;
        video.playsInline = true;            // iOS inline playback
        video.setAttribute("playsinline",""); // defensive
        video.removeAttribute("controls");   // keep overlay UI clean

        // 1) If no source buffered yet and preload might be light, nudge it
        try {
          // If the element has a source but hasn't started fetching, load it.
          // NETWORK_EMPTY (0) or NETWORK_IDLE(1) are ok to call load()
          if (video.networkState === 0 || video.networkState === 1) {
            // Calling load() is harmless if already loaded; some browsers ignore it.
            video.load();
          }
        } catch(_) {}

        // Helper: safe play with ignored rejections
        function tryPlay(){
          try {
            var p = video.play();
            if (p && typeof p.catch === "function") { p.catch(function(){ /* ignore NotAllowedError etc. */ }); }
          } catch(_) {}
        }

        // 2) First immediate attempt
        tryPlay();

        // 3) Retry when enough data is ready to start
        var onMeta = function(){ video.removeEventListener("loadedmetadata", onMeta); tryPlay(); };
        var onCanPlay = function(){ video.removeEventListener("canplay", onCanPlay); tryPlay(); };
        var onCanPlayThrough = function(){ video.removeEventListener("canplaythrough", onCanPlayThrough); tryPlay(); };
        video.addEventListener("loadedmetadata", onMeta, { passive: true });
        video.addEventListener("canplay", onCanPlay, { passive: true });
        video.addEventListener("canplaythrough", onCanPlayThrough, { passive: true });

        // 4) Belt-and-suspenders: one more small timed retry after layout settles
        setTimeout(tryPlay, 120);
      })(vids[i]);
    }
  };

  // ---------- Programmatic open/close (excerpt) ----------

  DrawerController.prototype.OpenDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    if (content.classList.contains("DrawerContent--Fill")) { drawer.classList.add("Drawer--NoTail"); }
    else { drawer.classList.remove("Drawer--NoTail"); }

    var startHeight = content.getBoundingClientRect().height | 0;
    content.style.height = Math.max(0, startHeight) + "px";

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    // Fire "opened" immediately (state toggled)
    document.dispatchEvent(new CustomEvent("drawer:opened", { detail: { id: drawer.id }}));

    // ✅ NEW: kick off autoplay immediately (first chance)
    this._autoplayVideos(drawer);

    var self = this;

    function dispatchOpenComplete(){
      document.dispatchEvent(new CustomEvent("drawer:open-complete", { detail: { id: drawer.id }}));
      // ✅ NEW: and *retry* autoplay once the drawer is fully laid out & visible
      self._autoplayVideos(drawer);
    }

    function measureEndHeight() {
      var prevH = content.style.height;
      var prevT = content.style.transition;
      content.style.transition = "";
      content.style.height = "";
      void content.offsetHeight;

      var end = content.getBoundingClientRect().height;
      if (!end || end < 1) { end = content.scrollHeight; }

      content.style.height = prevH || (Math.max(0, startHeight) + "px");
      content.style.transition = prevT;
      void content.offsetHeight;
      return Math.max(0, Math.round(end));
    }

    requestAnimationFrame(function () {
      var endHeight = measureEndHeight();

      if (Math.abs(endHeight - startHeight) < 0.5) {
        content.style.transition = "";
        if (drawer.classList.contains("Drawer--FixedHero") ||
            drawer.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill")) {
          content.style.height = "";
        } else {
          content.style.height = "auto";
        }
        self._isAnimating = false;
        self._drainQueue();
        dispatchOpenComplete(); // settled, do the post-open autoplay retry
        return;
      }

      self.AnimateHeight(content, startHeight, endHeight, dispatchOpenComplete);
    });

    this._wireMediaAutoGrow(content);
  };

  // ... rest of file unchanged ...
})();