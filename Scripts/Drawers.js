(function () {
  "use strict";

  // ===== Configuration (no magic numbers) =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll via “virtual line”
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 35% from top

  // Anti-flap after programmatic close
  var SuppressMsAfterProgrammaticClose = 250;

  // IO at a virtual "line" = 35% from top
  var RootMarginForAnchor =
    (-(ViewportAnchorFraction * 100)).toFixed(3) + "% 0px " +
    (-(100 - ViewportAnchorFraction * 100)).toFixed(3) + "% 0px";

  // Suppress IO reactions briefly during boot/programmatic open
  var SuppressIOAfterBootMs = 400;

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

    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // Start EVERYTHING closed (ignore whatever HTML had)
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      d.classList.remove("Drawer--Open", "Drawer--NoTail");
      var c = d.querySelector("[data-drawer-content]");
      if (c) c.style.height = "";
    }

    

    // Inject close markers at end of each content
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

    if (drawer.classList.contains("Drawer--Open")) {
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

    // Tail state for fill content
    if (content.classList.contains("DrawerContent--Fill")) {
      drawer.classList.add("Drawer--NoTail");
    } else {
      drawer.classList.remove("Drawer--NoTail");
    }

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    // Measure final height after the open class applies layout
    var self = this;
    requestAnimationFrame(function () {
      // For fixed-hero/short drawers, the clamped height is reflected in layout => use client height
      var endHeight = content.getBoundingClientRect().height || content.scrollHeight;
      self.AnimateHeight(content, startHeight, endHeight);
    });

    // Keep open panels in sync if media updates later
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

  // Animates to px, then sets auto for open state; pins the 35% line
  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight) {
    var self = this;

    // Capture the docY of the 35% line before we mutate
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var anchorDocYBefore = (window.pageYOffset || document.documentElement.scrollTop || 0)
                         + vh * ViewportAnchorFraction;

    // If another animation is in-flight, snap to its end state first
    if (this._isAnimating) {
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    // Phase 1: set start
    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight; // reflow

    // Phase 2: animate to target
    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function onEnd(e) {
      if (e.propertyName !== "height") return;

      element.removeEventListener("transitionend", onEnd);
      element.style.transition = "";

      // If opening, let it breathe for late media/layout by switching to auto
      if (endHeight > 0) {
        element.style.height = "auto";
      } else {
        element.style.height = "";
      }

      self._isAnimating = false;

      // Restore the 35% line after layout settles (double-rAF for 'auto' to commit)
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var anchorDocYAfter =
            (window.pageYOffset || document.documentElement.scrollTop || 0) +
            (window.innerHeight || document.documentElement.clientHeight) * ViewportAnchorFraction;

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
        if (content.classList.contains("DrawerContent--Fill")) {
          drawer.classList.add("Drawer--NoTail");
        } else {
          drawer.classList.remove("Drawer--NoTail");
        }
        // leave height as 'auto' for open panels (AnimateHeight sets it)
        content.style.height = "auto";
      } else {
        drawer.classList.remove("Drawer--NoTail");
        content.style.height = "";
      }
    }
  };

  // Keep an open drawer flexible if media sizes later
  DrawerController.prototype._wireMediaAutoGrow = function (content) {
    var medias = content.querySelectorAll("video, img, iframe");
    function maybeSync() {
      var d = content.closest("[data-drawer]");
      if (!d || !d.classList.contains("Drawer--Open")) return;
      // We keep height:auto while open, so growth is natural.
    }
    for (var i = 0; i < medias.length; i++) {
      var m = medias[i];
      m.addEventListener("loadedmetadata", maybeSync, { passive: true });
      m.addEventListener("loadeddata",     maybeSync, { passive: true });
      m.addEventListener("load",           maybeSync, { passive: true });
    }
  };

  // ---------- Auto open/close on scroll via "line" (IO at 35%) ----------

  DrawerController.prototype.EnableScrollAutoToggle = function () {
    var self = this;

    // Observe at the virtual 35% line
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

    // Direction tracking only
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

    // ignore during boot/programmatic open suppression
    if (this._booting || now < this._suppressIOUntil) return;

    // process in chronological order
    entries.sort(function (a, b) { return a.time - b.time; });

    for (var idx = 0; idx < entries.length; idx++) {
      var entry = entries[idx];
      if (!entry.isIntersecting) continue;       // only when entering the slice
      if (this._scrollDirection !== 1) continue; // unidirectional (down only)

      var target = entry.target;
      var drawer = target.closest("[data-drawer]");
      if (!drawer) continue;

      // respect lockout
      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) continue;

      if (target.matches("[data-drawer-summary]")) {
        if (!drawer.classList.contains("Drawer--Open")) {
          this.OpenDrawer(drawer);
          if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
        }
      } else if (target.matches("[data-close-marker]")) {
        if (drawer.classList.contains("Drawer--Open")) {
          this.CloseAndLock(drawer);
          var next = this._NextDrawer(drawer);
          if (next) {
            var lockedNext = parseFloat(next.dataset.lockedUntil || "0");
            if (lockedNext <= now && !next.classList.contains("Drawer--Open")) {
              this.OpenDrawer(next);
              if (OnlyOneOpenAtATime) this.CloseSiblings(next);
            }
          }
        }
      }
    }
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
    if (closeId) this.CloseById(closeId);
    this.OpenById(openId);
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

  // Single authoritative "open Intro" (IO temporarily suppressed)
  function openIntro() {
    var intro = document.getElementById("Intro");
    if (!intro) {
      instance._booting = false;
      return;
    }

    // Keep IO quiet while we do this programmatically
    instance._suppressIOUntil = instance._now() + SuppressIOAfterBootMs;

    // Open using the controller (ensures height/ARIA/tail are correct)
    instance.OpenById("Intro");

    // Try to play the hero video (muted/inline)
    var vid = intro.querySelector("video");
    if (vid) {
      try {
        vid.muted = true;
        vid.playsInline = true;
        var p = vid.play();
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) {}
    }

    // Release boot flag so IO takes over naturally
    setTimeout(function () { instance._booting = false; }, SuppressIOAfterBootMs);
  }

  // Wait two RAFs so CSS/layout (including video sizing rules) have committed
  requestAnimationFrame(function () {
    requestAnimationFrame(openIntro);
  });
}

    // Optional: visual guide line
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var instance = new DrawerController(document);
    window.DrawersController = instance;

    // After layout, ensure Intro is open (if not already) and start its video
    var openIntro = function () {
      var intro = document.getElementById("Intro");
      if (!intro) {
        instance._booting = false;
        return;
      }

      // suppress IO briefly so it doesn't fight this programmatic work
      instance._suppressIOUntil = instance._now() + SuppressIOAfterBootMs;

      if (!intro.classList.contains("Drawer--Open")) {
        instance.OpenById("Intro");
      }

      // try to play the hero video (muted/inline)
      var vid = intro.querySelector("video");
      if (vid) {
        try {
          vid.muted = true;
          vid.playsInline = true;
          var p = vid.play();
          if (p && typeof p.catch === "function") { p.catch(function(){ /* ignore */ }); }
        } catch(e) { /* ignore play errors */ }
      }

      // release boot flag after a tick so IO can take over
      setTimeout(function () { instance._booting = false; }, SuppressIOAfterBootMs);
    };

    // Wait two RAFs so styles/layout (including video CSS) settle
    requestAnimationFrame(function(){ requestAnimationFrame(openIntro); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;
})();