// ===================== PREMIUM =====================
function openPremium(){
  closeAccount();
  document.getElementById('premium-modal').classList.add('open');
}
function closePremium(){ document.getElementById('premium-modal').classList.remove('open'); }

function upgradePremium(){
  // In production: integrate with Google Play Billing or Stripe
  alert('Payment integration coming soon! For now, premium is unlocked for demo.');
  isPremium = true;
  savePremiumState(userId, true);
  logEvent('premium_upgrade', {method:'demo'});
  closePremium();
  buildYearBar(); render();
}
