(function () {
  "use strict";

  // ===== Configuration =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll via a single “virtual line”
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 35% from the top
  var OpenOffsetPx = 28;             // open slightly *below* that line

  // Anti-flap after programmatic close
  var SuppressMsAfterProgrammaticClose = 250;

  // Suppress IO reactions briefly during boot/programmatic open
  var SuppressIOAfterBootMs = 400;

  // Percent slice around our line (offset enforced with a geometry guard)
  function computeRootMargin() {
    var topPct = -(ViewportAnchorFraction * 100);
    var botPct = -(100 - ViewportAnchorFraction * 100);
    return topPct.toFixed(3) + "% 0px " + botPct.toFixed(3) + "% 0px";
  }

  // ============================================

  function DrawerController(root) {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;
    this._observer = null;

    // Direction tracking
    this._lastScrollY = window.pageYOffset || 0;
    this._scrollDirection = 1; // seed as "down"

    // Boot/IO suppression
    this._booting = true;
    this._suppressIOUntil = 0;

    this._now = function () {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    };

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function () {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    // Start EVERYTHING closed (ignore whatever HTML had)
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      d.classList.remove("Drawer--Open", "Drawer--NoTail");
      var c = d.querySelector("[data-drawer-content]");
      if (c) c.style.height = "";
    }

    // Wire summary clicks/keys
    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    this.SyncAria();
    this.SyncHeights();

    if (AutoOpenOnScroll) this.EnableScrollAutoToggle();
  };

  // ---------- Interaction ----------

  DrawerController.prototype.OnSummaryKeyDown = function (evt) {
    var key = evt.key || "";
    if (key === " " || key === "Enter" || evt.keyCode === 32 || evt.keyCode === 13) {
      evt.preventDefault();
      this.OnToggleRequested(evt);
    }
  };

    DrawerController.prototype.OnToggleRequested = function (evt) {
    if (this._isAnimating) return;
    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
    } else {
      this.OpenDrawer(drawer);

      // 🛡️ Suppress IO briefly so the open-induced layout shift doesn't auto-open the next drawer
      this._suppressIOUntil = this._now() + 450;   // << add this

      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
    }
  };

  // ---------- Programmatic open/close ----------

  DrawerController.prototype.OpenDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    // Tail state for fill content
    if (content.classList.contains("DrawerContent--Fill")) {
      drawer.classList.add("Drawer--NoTail");
    } else {
      drawer.classList.remove("Drawer--NoTail");
    }

    var startHeight = content.getBoundingClientRect().height | 0;

    // Pin current height so we don't collapse while we prep animation
    content.style.height = Math.max(0, startHeight) + "px";

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    var self = this;

    // Measure end height with inline height cleared so CSS (dvh clamp) can apply
    function measureEndHeight() {
      var prevH = content.style.height;
      var prevT = content.style.transition;
      content.style.transition = "";
      content.style.height = ""; // let CSS open-state height apply
      void content.offsetHeight;

      var end = content.getBoundingClientRect().height;
      if (!end || end < 1) {
        // fallback for non-flow children (absolute video): scrollHeight may still be 0; that's ok
        end = content.scrollHeight;
      }

      // Restore start height for the animation
      content.style.height = prevH || (Math.max(0, startHeight) + "px");
      content.style.transition = prevT;
      void content.offsetHeight;
      return Math.max(0, Math.round(end));
    }

    // Run after layout applies the open class
    requestAnimationFrame(function () {
      var endHeight = measureEndHeight();

      // Fast-path: if there's nothing to animate, finish immediately (prevents lock)
      if (Math.abs(endHeight - startHeight) < 0.5) {
        content.style.transition = "";
        content.style.height = "auto";
        self._isAnimating = false;
        return;
      }

      self.AnimateHeight(content, startHeight, endHeight);
    });

    // Keep open panels healthy if media sizes even later
    this._wireMediaAutoGrow(content);
  };

  DrawerController.prototype.CloseDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    drawer.classList.remove("Drawer--NoTail");
    this.SetAriaExpanded(drawer, false);

    // Pause/rewind any videos in this drawer
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {}
    }

    var endHeight = 0;
    // If nothing to animate, finish immediately
    if (Math.abs(endHeight - startHeight) < 0.5) {
      content.style.transition = "";
      content.style.height = "";
      this._isAnimating = false;
      return;
    }

    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.CloseAndLock = function (drawer) {
    this.CloseDrawer(drawer);
    drawer.dataset.lockedUntil = String(this._now() + SuppressMsAfterProgrammaticClose);
  };

  DrawerController.prototype.CloseSiblings = function (exceptDrawer) {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      if (d !== exceptDrawer && d.classList.contains("Drawer--Open")) {
        this.CloseDrawer(d);
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight) {
    var self = this;

    // pin the 35% line (so the page doesn't "shoot")
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var anchorDocYBefore = (window.pageYOffset || document.documentElement.scrollTop || 0)
                         + vh * ViewportAnchorFraction + OpenOffsetPx;

    if (this._isAnimating) {
      // snap any in-flight to end state to avoid lock
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function onEnd(e) {
      if (e.propertyName !== "height") return;
      element.removeEventListener("transitionend", onEnd);

      element.style.transition = "";
      element.style.height = (endHeight > 0) ? "auto" : "";

      self._isAnimating = false;

      // restore the 35%+offset line after layout settles
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var anchorDocYAfter =
            (window.pageYOffset || document.documentElement.scrollTop || 0) +
            (window.innerHeight || document.documentElement.clientHeight) * ViewportAnchorFraction +
            OpenOffsetPx;

          var delta = anchorDocYAfter - anchorDocYBefore;
          if (Math.abs(delta) > 0.5) window.scrollBy(0, -delta);
        });
      });
    }

    element.addEventListener("transitionend", onEnd);
  };

  DrawerController.prototype.SyncAria = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary) continue;
      summary.setAttribute("aria-expanded", drawer.classList.contains("Drawer--Open") ? "true" : "false");
    }
  };

  DrawerController.prototype.SetAriaExpanded = function (drawer, expanded) {
    var summary = drawer.querySelector("[data-drawer-summary]");
    if (summary) summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  DrawerController.prototype.SyncHeights = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var content = drawer.querySelector("[data-drawer-content]");
      if (!content) continue;

      if (drawer.classList.contains("Drawer--Open")) {
        if (content.classList.contains("DrawerContent--Fill")) {
          drawer.classList.add("Drawer--NoTail");
        } else {
          drawer.classList.remove("Drawer--NoTail");
        }
        content.style.height = "auto";
      } else {
        drawer.classList.remove("Drawer--NoTail");
        content.style.height = "";
      }
    }
  };

  // Keep an open drawer healthy if media sizes late
  DrawerController.prototype._wireMediaAutoGrow = function (content) {
    var medias = content.querySelectorAll("video, img, iframe");
    function maybeSync() {
      var d = content.closest("[data-drawer]");
      if (!d || !d.classList.contains("Drawer--Open")) return;
      content.style.height = "auto"; // let it breathe
    }
    for (var i = 0; i < medias.length; i++) {
      var m = medias[i];
      m.addEventListener("loadedmetadata", maybeSync);
      m.addEventListener("loadeddata",     maybeSync);
      m.addEventListener("load",           maybeSync);
    }
  };
  
// --- Auto-advance video drawers (safe: only if playback truly started) ---
DrawerController.prototype._wireAutoAdvanceVideo = function (drawerId, nextId) {
  var drawer = document.getElementById(drawerId);
  if (!drawer) return;
  var content = drawer.querySelector("[data-drawer-content]");
  var video   = content ? content.querySelector("video") : null;
  if (!video) return;

  var self = this;
  var started = false; // becomes true only after we actually see playback begin

  function tryPlay() {
    try {
      video.muted = true;
      video.playsInline = true;
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function(){});
    } catch(e) {}
  }

  video.addEventListener("playing", function () { started = true; }, { passive:true });
  video.addEventListener("loadedmetadata", function () {
    // If Intro opens from top with autoplay, kick it once metadata is ready.
    // (Harmless if it’s already playing.)
    tryPlay();
  }, { passive:true });

  video.addEventListener("ended", function () {
    // Only advance if we truly started playback (avoid “instant end” glitches)
    if (!started) return;

    // Don’t do anything if the current drawer got closed manually
    if (!drawer.classList.contains("Drawer--Open")) return;

    // Keep IO quiet while we programmatically advance
    self._suppressIOUntil = self._now() + 600;

    if (nextId) {
      self.OpenThenCloseAndScroll(nextId, drawerId);
    } else {
      // If no nextId is provided, just close this one gracefully
      self.CloseAndLock(drawer);
    }
  }, { passive:true });
};

  // ---------- Auto open on scroll (titles only) ----------

  DrawerController.prototype.EnableScrollAutoToggle = function () {
    var self = this;

    this._observer = new IntersectionObserver(function (entries) {
      self._OnIntersections(entries);
    }, {
      root: null,
      threshold: 0,
      rootMargin: computeRootMargin()
    });

    // Observe only the titles (open markers)
    for (var i = 0; i < this._summaries.length; i++) {
      this._observer.observe(this._summaries[i]);
    }

    function onScroll() {
      var y = window.pageYOffset || 0;
      self._scrollDirection = (y > self._lastScrollY) ? 1 : (y < self._lastScrollY) ? -1 : self._scrollDirection;
      self._lastScrollY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  };

  DrawerController.prototype._OnIntersections = function (entries) {
    var now = this._now();
    if (this._booting || now < this._suppressIOUntil) return;

    // chronological
    entries.sort(function (a, b) { return a.time - b.time; });

    for (var idx = 0; idx < entries.length; idx++) {
      var entry = entries[idx];
      if (!entry.isIntersecting) continue;        // entering the slice only
      if (this._scrollDirection !== 1) continue;  // down only

      var summary = entry.target;
      if (!summary.hasAttribute("data-drawer-summary")) continue;

      var drawer = summary.closest("[data-drawer]");
      if (!drawer) continue;

      // Geometric guard: ensure the summary is actually below the anchor by our offset
      var rect = summary.getBoundingClientRect();
      var anchorY = (window.innerHeight || document.documentElement.clientHeight) * ViewportAnchorFraction + OpenOffsetPx;
      if (rect.top > anchorY) continue; // not far enough yet

      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) continue;

      if (!drawer.classList.contains("Drawer--Open")) {
        this.OpenDrawer(drawer);
        if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
        // brief suppression so the open-induced layout shift doesn't chain-trigger
        this._suppressIOUntil = this._now() + 150;
      }
    }
  };

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // ---------- Public helpers ----------

    DrawerController.prototype.OpenById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);

      // 🛡️ Suppress IO to avoid chain-opening via layout shift
      this._suppressIOUntil = this._now() + 450;   // << add this

      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
    }
  };

  DrawerController.prototype.CloseById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (drawer.classList.contains("Drawer--Open")) this.CloseAndLock(drawer);
  };

  DrawerController.prototype.ScrollToDrawer = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    var title = drawer.querySelector("[data-drawer-summary]") || drawer;
    var y = title.getBoundingClientRect().top + window.pageYOffset - 16;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId) {
    if (closeId) this.CloseById(closeId);
    this.OpenById(openId);
    this.ScrollToDrawer(openId);
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    document.documentElement.style.setProperty(
      "--ViewportAnchorTriggerLinePositionVh",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // Optional: visual guide line
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var instance = new DrawerController(document);
    window.DrawersController = instance;

    // Open Intro once layout settles (and keep IO quiet while we do it)
function openIntro() {
  var intro = document.getElementById("Intro");
  if (!intro) { instance._booting = false; return; }

  // Wire safe auto-advance: Intro -> About
  instance._wireAutoAdvanceVideo("Intro", "About");  // << add this line
  // (Optionally wire Tour to advance to Capabilities, etc.)
  // instance._wireAutoAdvanceVideo("Tour", "Capabilities");

  instance._suppressIOUntil = instance._now() + SuppressIOAfterBootMs;
  instance.OpenById("Intro");

  var vid = intro.querySelector("video");
  if (vid) {
    try {
      vid.muted = true;
      vid.playsInline = true;
      var p = vid.play();
      if (p && typeof p.catch === "function") p.catch(function(){});
    } catch (e) {}
  }

  setTimeout(function () { instance._booting = false; }, SuppressIOAfterBootMs);
}

    requestAnimationFrame(function(){ requestAnimationFrame(openIntro); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;
})();