(function(){
  "use strict";

  function TabBarController(){
    this._elBar   = document.getElementById("TabBar");
    this._track   = document.getElementById("TabBarTrack");
    this._tabs    = new Map(); // id -> button
    this._order   = [];        // drawer id order
    this._heroId  = null;      // first (hero) drawer id
    this._active  = null;
    this._heroCollapsed = false; // track whether Intro has collapsed

    if (!this._elBar || !this._track) return;

    this._buildFromDrawers();
    this._wire();
    this._applyVisibility(this._active);  // correct initial state
  }

  TabBarController.prototype._buildFromDrawers = function(){
    this._tabs.clear();
    this._order = [];
    this._track.innerHTML = "";

    var drawers = document.querySelectorAll("[data-drawer]");
    for (var i=0; i<drawers.length; i++){
      var d = drawers[i];
      var id = d.id || ("drawer-"+i);
      if (!d.id) d.id = id;
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
      tab.style.display = "none"; // hidden until allowed
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

  TabBarController.prototype._wire = function(){
    var self = this;

    // Update tabs when drawers actually open
    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id){
        self.setActive(e.detail.id);
        self._applyVisibility(e.detail.id);
        self._renderTabsVisibility();
      }
    });

    // No anchor-based auto-activation anymore.
  };

  TabBarController.prototype._onTabClick = function(evt){
    var id = evt.currentTarget.getAttribute("data-tab-target");
    if (!id) return;

    this.setActive(id);        // optimistic
    this._applyVisibility(id);
    this._renderTabsVisibility();

    if (window.DrawersController && typeof window.DrawersController.OpenThenCloseAndScroll === "function"){
      window.DrawersController.OpenThenCloseAndScroll(id, "");
    } else {
      var el = document.getElementById(id);
      if (el){
        var y = el.getBoundingClientRect().top + window.pageYOffset - 56;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }
  };

  TabBarController.prototype._applyVisibility = function(activeId){
    var shouldShow = !!activeId && activeId !== this._heroId;

    // toggle body class for styling
    document.body.classList.toggle("Tabs--Visible", shouldShow);

    // toggle aria-hidden on bar
    if (this._elBar){
      this._elBar.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    }

    // On first leave from hero, collapse it and snap the active drawer under the bar
    if (activeId && activeId !== this._heroId && !this._heroCollapsed){
      var hero = document.getElementById(this._heroId);
      if (hero){
        hero.style.display = "none";
        this._heroCollapsed = true;

        // Snap the current active drawer's title under the 56px tab bar
        var active = document.getElementById(activeId);
        if (active){
          var title = active.querySelector("[data-drawer-summary]") || active;
          var tabBarH = 56; // keep in sync with CSS
          var targetY = title.getBoundingClientRect().top + window.pageYOffset - tabBarH;

          // Cancel momentum and place exactly
          window.scrollTo({ top: targetY, behavior: "auto" });
          requestAnimationFrame(function(){
            window.scrollTo({ top: targetY, behavior: "auto" });
          });
        }

        // Debounce IO + block user scroll during settle
        if (window.DrawersController){
          if (typeof window.DrawersController._now === "function"){
            window.DrawersController._suppressIOUntil =
              window.DrawersController._now() + 500;
          }
          if (typeof window.DrawersController.FreezeInput === "function"){
            window.DrawersController.FreezeInput(600); // block wheel/touch/key briefly
          }
          if (typeof window.DrawersController.ResetAccumulatedInput === "function"){
            window.DrawersController.ResetAccumulatedInput();
          }
        }

        // Ensure Intro tab appears now that hero is collapsed
        this._renderTabsVisibility && this._renderTabsVisibility();
      }
    }
  };

  // 🔑 Only show tabs up to (and including) the active index.
  TabBarController.prototype._renderTabsVisibility = function(){
    var activeIdx = this._order.indexOf(this._active);
    if (activeIdx < 0) activeIdx = 0;

    for (var i=0; i<this._order.length; i++){
      var id = this._order[i];
      var t = this._tabs.get(id);
      if (!t) continue;

      // Hide the hero tab until we've actually collapsed the hero section
      if (id === this._heroId && !this._heroCollapsed){
        t.style.display = "none";
        continue;
      }

      var show = i <= activeIdx;  // progressive reveal (now tied ONLY to opened/clicked)
      t.style.display = show ? "inline-block" : "none";
    }
  };

  TabBarController.prototype.setActive = function(id){
    if (!this._tabs.size) return;

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

    // Past-state cosmetics
    var seenActive = false;
    for (var i=0; i<this._order.length; i++){
      var cid = this._order[i];
      var t = this._tabs.get(cid);
      if (!t) continue;
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

  // Boot
  function init(){
    if (window.TabBar && window.TabBar._elBar) return;
    window.TabBar = new TabBarController();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();