<script>
(function(){
  "use strict";

  function TabBarController(){
    this._elBar   = document.getElementById("TabBar");
    this._track   = document.getElementById("TabBarTrack");
    this._tabs    = new Map(); // id -> button
    this._order   = [];        // drawer id order
    this._active  = null;

    if (!this._elBar || !this._track) return;

    this._buildFromDrawers();
    this._wire();
  }

  TabBarController.prototype._buildFromDrawers = function(){
    var drawers = document.querySelectorAll("[data-drawer]");
    this._order = [];
    for (var i=0; i<drawers.length; i++){
      var d = drawers[i];
      var id = d.id || ("drawer-"+i);
      if (!d.id) d.id = id;
      this._order.push(id);

      var title = (d.querySelector("[data-drawer-summary]") || d).textContent.trim();
      var tab = document.createElement("button");
      tab.className = "Tab";
      tab.setAttribute("role","tab");
      tab.setAttribute("data-tab-target", id);
      tab.textContent = title;
      tab.addEventListener("click", this._onTabClick.bind(this));
      this._track.appendChild(tab);
      this._tabs.set(id, tab);
    }

    // First visible as active on load (Intro will promote itself shortly)
    if (this._order.length){
      this.setActive(this._order[0]);
    }
  };

  TabBarController.prototype._wire = function(){
    var self = this;

    // React when drawers open/close
    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id) self.setActive(e.detail.id);
    });

    // As a safety, track scroll anchor to highlight the nearest drawer when user scrolls manually
    var ticking = false;
    window.addEventListener("scroll", function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        self._syncByAnchor();
      });
    }, {passive:true});
  };

  TabBarController.prototype._onTabClick = function(evt){
    var id = evt.currentTarget.getAttribute("data-tab-target");
    if (!id) return;

    this.setActive(id); // optimistic UI

    if (window.DrawersController && typeof window.DrawersController.OpenThenCloseAndScroll === "function"){
      window.DrawersController.OpenThenCloseAndScroll(id, ""); // controller enforces only-one-open
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
    var anchorY = vh * 0.35; // match your ViewportAnchorFraction
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
  };

  TabBarController.prototype.setActive = function(id){
    if (!this._tabs.size) return;

    // classes
    if (this._active && this._tabs.has(this._active)){
      this._tabs.get(this._active).classList.remove("Tab--Active");
    }
    this._active = id;
    if (this._tabs.has(id)){
      this._tabs.get(id).classList.add("Tab--Active");
    }

    // mark all tabs up to active as "past", others normal
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
      }else if (seenActive){
        t.classList.remove("Tab--Past");
      }
    }
  };

  // expose
  window.TabBar = new TabBarController();
})();
</script>