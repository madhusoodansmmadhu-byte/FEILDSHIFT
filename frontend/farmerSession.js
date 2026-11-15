'use strict';
(() => {
  const key = 'agrishift_farmer_land';
  window.FarmerSession = {
    saveFarmerLand(data) { try { sessionStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; } },
    getFarmerLand() { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } },
    clearFarmerLand() { try { sessionStorage.removeItem(key); } catch {} }
  };
})();
