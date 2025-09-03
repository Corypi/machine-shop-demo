(function(){
  "use strict";

  // ==========================================================
  // TabBarController
  // - Builds a progressive TabBar that mirrors [data-drawer] sections.
  // - Delegates open/scroll behavior to DrawersController when available.
  // - Keeps the CSS variable --TabBarOffsetPixels in sync with the bar's
  //   actual height so snapping via scroll-margin-top is exact.
  // - NEW: When tabs are visible ("tab mode"), only the active drawer
  //   stays in the DOM flow; others are hidden via DrawersController.
  // ==========================================================

  function TabBarController(){
    this._elBar         = document.getElementById("TabBar");
    this._track         = document.getElementById("TabBarTrack");
    this._tabs          = new Map(); // id -> button
    this._order         = [];        // drawer id order
    this._heroId        = null;      // first (hero) drawer id
    this._active        = null;
    this._heroCollapsed = false;

    if (!this._elBar || !this._track) { return; }

    this._buildFromDrawers();
    this._wire();
    this._applyVisibility(this._active);
    this._updateTabBarOffsetVar(); // initialize CSS offset
  }

  // ---------- Internal: CSS var sync for snap offset ----------
  TabBarController.prototype._updateTabBarOffsetVar = function(){
    var h = this._elBar ? Math.round(this._elBar.getBoundingClientRect().height || 0) : 0;
    document.documentElement.style.setProperty("--TabBarOffsetPixels", h + "px");
  };

  // ---------- Build tabs from drawers ----------
  TabBarController.prototype._buildFromDrawers = function(){
    this._tabs.clear();
    this._order = [];
    this._track.innerHTML = "";

    var drawers = document.querySelectorAll("[data-drawer]");
    for (var i = 0; i < drawers.length; i++){
      var d = drawers[i];
      var id = d.id || ("drawer-" + i);
      if (!d.id) { d.id = id; }
      this._order.push(id);

      var titleEl = d.querySelector("[data-drawer-summary]") || d;
      var title = (titleEl.textContent || "").trim();

      var tab = document.createElement("button");
      tab.className = "Tab";
      tab.type = "button";
      tab.setAttribute("role","tab");
      tab.setAttribute("aria-selected","false");
      tab.setAttribute("data-tab-target", id);
      tab.setAttribute("aria-controls", id);
      tab.textContent = title;
      tab.style.display = "none";
      tab.addEventListener("click", this._onTabClick.bind(this));

      this._track.appendChild(tab);
      this._tabs.set(id, tab);
    }

    this._heroId = this._order.length ? this._order[0] : null;

    if (this._order.length){
      this.setActive(this._order[0]);
    }
    this._renderTabsVisibility();
  };

  // ---------- Events / wiring ----------
  TabBarController.prototype._wire = function(){
    var self = this;

    // Keep CSS var updated on resize/orientation changes
    window.addEventListener("resize", function(){
      self._updateTabBarOffsetVar();
    }, { passive: true });

    // Reflect drawer open events into the TabBar (active state, visibility)
    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id){
        self.setActive(e.detail.id);
        self._applyVisibility(e.detail.id);
        self._renderTabsVisibility();
        self._updateTabBarOffsetVar();
        // Ensure tab-mode visibility policy is enforced by Drawers
        if (window.DrawersController && typeof window.DrawersController._applyTabModeVisibility === "function"){
          window.DrawersController._applyTabModeVisibility(e.detail.id);
        }
      }
    });

    // When hero is collapsed by DrawersController, show bar and refresh.
    // Also enter "tab mode": only the active drawer should remain in flow.
    document.addEventListener("hero:collapsed", function(){
      self._heroCollapsed = true;
      document.body.classList.add("Tabs--Visible");
      if (self._elBar) { self._elBar.setAttribute("aria-hidden","false"); }
      self._renderTabsVisibility();
      self._applyVisibility(self._active);
      self._updateTabBarOffsetVar();

      if (window.DrawersController && typeof window.DrawersController._applyTabModeVisibility === "function"){
        window.DrawersController._applyTabModeVisibility(self._active);
      }
    });
  };

  // ---------- Tab click -> delegate to DrawersController ----------
  TabBarController.prototype._onTabClick = function(evt){
    var id = evt.currentTarget.getAttribute("data-tab-target");
    if (!id) { return; }

    this.setActive(id);
    this._applyVisibility(id);
    this._renderTabsVisibility();
    this._updateTabBarOffsetVar();

    // Enter/maintain tab mode immediately: hide non-active drawers now.
    if (window.DrawersController && typeof window.DrawersController._applyTabModeVisibility === "function"){
      window.DrawersController._applyTabModeVisibility(id);
    }

    // Prefer unified programmatic path (will open + snap robustly)
    if (window.DrawersController && typeof window.DrawersController.OpenThenCloseAndScroll === "function"){
      window.DrawersController.OpenThenCloseAndScroll(id, "");
      return;
    }

    // Fallback: native snap using scroll-margin-top
    var el = document.getElementById(id);
    if (el){
      var title = el.querySelector("[data-drawer-summary]") || el;
      title.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
    }
  };

  // ---------- Show/hide TabBar ----------
  TabBarController.prototype._applyVisibility = function(activeId){
    var shouldShow = !!activeId && activeId !== this._heroId;

    document.body.classList.toggle("Tabs--Visible", shouldShow);

    if (this._elBar){
      this._elBar.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    }
  };

  // ---------- Render: only show tabs up to (and including) the active ----------
  TabBarController.prototype._renderTabsVisibility = function(){
    var activeIdx = this._order.indexOf(this._active);
    if (activeIdx < 0) { activeIdx = 0; }

    for (var i = 0; i < this._order.length; i++){
      var id = this._order[i];
      var t = this._tabs.get(id);
      if (!t) { continue; }

      // Hide the hero tab until hero is truly collapsed
      if (id === this._heroId && !this._heroCollapsed){
        t.style.display = "none";
        continue;
      }

      var show = i <= activeIdx;
      t.style.display = show ? "inline-block" : "none";
    }
  };

  // ---------- Active state management ----------
  TabBarController.prototype.setActive = function(id){
    if (!this._tabs.size) { return; }

    if (this._active && this._tabs.has(this._active)){
      var prev = this._tabs.get(this._active);
      prev.classList.remove("Tab--Active");
      prev.setAttribute("aria-selected","false");
    }

    this._active = id;

    if (this._tabs.has(id)){
      var cur = this._tabs.get(id);
      cur.classList.add("Tab--Active");
      cur.setAttribute("aria-selected","true");
    }

    var seenActive = false;
    for (var i = 0; i < this._order.length; i++){
      var cid = this._order[i];
      var t = this._tabs.get(cid);
      if (!t) { continue; }

      if (!seenActive){
        t.classList.add("Tab--Past");
      }
      if (cid === id){
        seenActive = true;
        t.classList.remove("Tab--Past");
      } else if (seenActive){
        t.classList.remove("Tab--Past");
      }
    }

    this._renderTabsVisibility();
  };

  // ---------- Boot ----------
  function init(){
    if (window.TabBar && window.TabBar._elBar) { return; }
    window.TabBar = new TabBarController();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();