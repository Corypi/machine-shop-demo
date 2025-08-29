(function () {
  "use strict";

  // ===== Configuration (no magic numbers) =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 0.5 = center; 0.35 is 35% from top

  // Debounce auto-open so it triggers after scrolling pauses
  var PauseAutoOpenWhileScrolling = true;
  var ScrollIdleMs = 120;

  // Anti-flap controls
  var SuppressMsAfterProgrammaticClose = 700; // just-closed shouldn't re-open

  // IO at a virtual "line" = 35% from top. -35% top margin, -65% bottom margin.
  // Any target that touches that horizontal slice will trigger the observer.
  var RootMarginForAnchor = (-(ViewportAnchorFraction * 100)).toFixed(3) + "% 0px " +
                            (-(100 - ViewportAnchorFraction * 100)).toFixed(3) + "% 0px";

  // ============================================

  function DrawerController(root) {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;
    this._observer = null;
    this._scrollRafPending = false;

    // Debounce state
    this._scrollIdleTimerId = null;
    this._isScrollIdle = true;

    // Direction tracking
    this._lastScrollY = window.pageYOffset || 0;

    this._now = function () {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    };

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function () {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // Ensure only #Intro is open initially
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      if (d.id !== "Intro") d.classList.remove("Drawer--Open");
    }

    // Inject close markers (one per drawer, at the very end of content)
    this._InstallCloseMarkers();

    this.SyncAria();
    this.SyncHeights();

    if (AutoOpenOnScroll) this.EnableScrollAutoToggle();
  };

  DrawerController.prototype._InstallCloseMarkers = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var content = d.querySelector("[data-drawer-content]");
      if (!content) continue;

      if (!content.querySelector("[data-close-marker]")) {
        var marker = document.createElement("div");
        marker.setAttribute("data-close-marker", "");
        marker.style.cssText = "position:relative;height:1px;width:1px;pointer-events:none;";
        content.appendChild(marker);
      }
    }
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

    var isOpen = drawer.classList.contains("Drawer--Open");
    if (isOpen) {
      this.CloseAndLock(drawer);
    } else {
      this.OpenDrawer(drawer);
      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
    }
  };

  // ---------- Programmatic open/close ----------

DrawerController.prototype.OpenDrawer = function (drawer) {
  var content = drawer.querySelector("[data-drawer-content]");
  if (!content) return;

  // If this drawer’s content fills edge-to-edge, drop the panel tail via CSS
  if (content.classList.contains("DrawerContent--Fill")) {
    drawer.classList.add("Drawer--NoTail");
  } else {
    drawer.classList.remove("Drawer--NoTail");
  }

  var startHeight = content.getBoundingClientRect().height;

  drawer.classList.add("Drawer--Open");
  this.SetAriaExpanded(drawer, true);

  var endHeight = content.scrollHeight;
  this.AnimateHeight(content, startHeight, endHeight);
};

DrawerController.prototype.CloseDrawer = function (drawer) {
  var content = drawer.querySelector("[data-drawer-content]");
  if (!content) return;

  var startHeight = content.getBoundingClientRect().height;

  drawer.classList.remove("Drawer--Open");
  drawer.classList.remove("Drawer--NoTail"); // reset
  this.SetAriaExpanded(drawer, false);

  // Pause/rewind any videos in this drawer
  var vids = drawer.querySelectorAll("video");
  for (var i = 0; i < vids.length; i++) {
    try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {}
  }

  var endHeight = 0;
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

    if (this._isAnimating) {
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function OnTransitionEnd(e) {
      if (e.propertyName === "height") {
        element.style.transition = "";
        element.style.height = endHeight > 0 ? (endHeight + "px") : "";
        element.removeEventListener("transitionend", OnTransitionEnd);
        self._isAnimating = false;
      }
    }

    element.addEventListener("transitionend", OnTransitionEnd);
  };

  DrawerController.prototype.SyncAria = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary) continue;
      var isOpen = drawer.classList.contains("Drawer--Open");
      summary.setAttribute("aria-expanded", isOpen ? "true" : "false");
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
        content.style.height = content.scrollHeight + "px";
      } else {
        content.style.height = "";
      }
    }
  };

  // ---------- Auto open/close on scroll via "lines" (IO at 35%) ----------

  DrawerController.prototype.EnableScrollAutoToggle = function () {
    var self = this;

    // Observe at the virtual 35% line using rootMargin trick
    this._observer = new IntersectionObserver(function (entries) {
      self._OnIntersections(entries);
    }, {
      root: null,
      threshold: 0,
      rootMargin: RootMarginForAnchor
    });

    // Observe each open marker (summary) and each close marker (content end)
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var summary = d.querySelector("[data-drawer-summary]");
      var closeMarker = d.querySelector("[data-close-marker]");
      if (summary) this._observer.observe(summary);
      if (closeMarker) this._observer.observe(closeMarker);
    }

    // Scroll/resize debouncing + direction tracking
    var onScroll = function () {
      var y = window.pageYOffset || 0;
      self._scrollDirection = (y > self._lastScrollY) ? 1 : (y < self._lastScrollY) ? -1 : 0;
      self._lastScrollY = y;

      if (PauseAutoOpenWhileScrolling) {
        self._isScrollIdle = false;
        if (self._scrollIdleTimerId) clearTimeout(self._scrollIdleTimerId);
        self._scrollIdleTimerId = setTimeout(function () {
          self._isScrollIdle = true;
        }, ScrollIdleMs);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Initial direction seed
    this._scrollDirection = 1;
  };

  DrawerController.prototype._OnIntersections = function (entries) {
    if (PauseAutoOpenWhileScrolling && !this._isScrollIdle) return;

    var now = this._now();
    var self = this;

    // Sort by time to process in order
    entries.sort(function (a, b) { return a.time - b.time; });

    entries.forEach(function (entry) {
      // We only act when target *enters* the 35% slice (isIntersecting = true).
      if (!entry.isIntersecting) return;

      // We only act when scrolling **down** so behavior is unidirectional
      if (self._scrollDirection !== 1) return;

      var target = entry.target;
      var drawer = target.closest("[data-drawer]");
      if (!drawer) return;

      // Respect lockout
      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) return;

     if (target.matches("[data-drawer-summary]")) {
  // OPEN MARKER crossed the line → open this drawer
  if (!drawer.classList.contains("Drawer--Open")) {
    self.OpenDrawer(drawer);
    if (OnlyOneOpenAtATime) self.CloseSiblings(drawer);
  }
} else if (target.matches("[data-close-marker]")) {
  // CLOSE MARKER (content bottom) crossed the line → close this and open next
  if (drawer.classList.contains("Drawer--Open")) {
    self.CloseAndLock(drawer);
    var next = self._NextDrawer(drawer);
    if (next) {
      var lockedNext = parseFloat(next.dataset.lockedUntil || "0");
      if (lockedNext <= now && !next.classList.contains("Drawer--Open")) {
        self.OpenDrawer(next);
        if (OnlyOneOpenAtATime) self.CloseSiblings(next);
      }
    }
  }
}
    });
  };

  DrawerController.prototype._NextDrawer = function (drawer) {
    for (var i = 0; i < this._drawers.length; i++) {
      if (this._drawers[i] === drawer) {
        return (i + 1 < this._drawers.length) ? this._drawers[i + 1] : null;
      }
    }
    return null;
  };

  // ---------- Public helpers ----------

  DrawerController.prototype.OpenById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);
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
    this.OpenById(openId);
    this.CloseById(closeId);
    this.ScrollToDrawer(openId);
  };

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    // Sync CSS var so yellow guide matches the JS anchor
    document.documentElement.style.setProperty(
      "--ViewportAnchorTriggerLinePositionVh",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // Optional: keep the visual guide
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var root = document;
    var instance = new DrawerController(root);
    window.DrawersController = instance;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;

})();