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

    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id){
        self.setActive(e.detail.id);
        self._applyVisibility(e.detail.id);
        self._renderTabsVisibility();
      }
    });

    var ticking = false;
    window.addEventListener("scroll", function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        var id = self._syncByAnchor();
        self._applyVisibility(id);
        // visibility is driven by drawer:opened + _renderTabsVisibility
      });
    }, {passive:true});
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

  TabBarController.prototype._syncByAnchor = function(){
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var anchorY = vh * 0.35;
    var best = null, bestDist = Infinity;

    for (var i=0; i<this._order.length; i++){
      var id = this._order[i];
      var d  = document.getElementById(id);
      if (!d) continue;
      var title = d.querySelector("[data-drawer-summary]") || d;
      var rect = title.getBoundingClientRect();
      var dist = Math.abs(rect.top - anchorY);
      if (dist < bestDist){
        bestDist = dist; best = id;
      }
    }
    if (best && best !== this._active){
      this.setActive(best);
    }
    return best || this._active;
  };

  TabBarController.prototype._applyVisibility = function(activeId){
    var shouldShow = !!activeId && activeId !== this._heroId;
    document.body.classList.toggle("Tabs--Visible", shouldShow);
    if (this._elBar){
      this._elBar.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    }

    // On first leave from hero, collapse it and allow its tab
    if (activeId && activeId !== this._heroId && !this._heroCollapsed){
      var hero = document.getElementById(this._heroId);
      if (hero){
        hero.style.display = "none";
        this._heroCollapsed = true;
        this._renderTabsVisibility();
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

      var show = i <= activeIdx;  // progressive reveal
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