// ============================================================
// Analytics Events — client-side snippet injected into every page
// + server-side sign_up event helper
// ============================================================

/**
 * Client-side analytics script injected into every HTML page response.
 * Extends the existing rrTrack() with funnel-specific events and
 * wires up Microsoft Clarity session recording.
 *
 * Microsoft Clarity project ID — set CLARITY_PROJECT_ID in env or
 * replace the placeholder below.
 */
export function buildClientAnalyticsScript(clarityProjectId: string): string {
  if (!clarityProjectId) return ''
  return `
<!-- Microsoft Clarity -->
<script>
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,'clarity','script','${clarityProjectId}');
// Expose helper so Clarity custom events can be fired from anywhere
window.clarityEvent = function(name, val) {
  try { clarity('set', name, val || '1'); } catch(e) {}
};
// Auto-tag authenticated users
(function(){
  try {
    var c = localStorage.getItem('rc_customer');
    if (c) { var u = JSON.parse(c); if (u && u.id) clarity('identify', String(u.id)); }
  } catch(e) {}
})();
</script>`
}

/**
 * Fire a server-side sign_up GA4 event + Clarity custom event placeholder.
 * Call from the register endpoint after successful customer creation.
 */
export async function trackSignupEvent(
  env: any,
  customerId: number,
  method: 'email' | 'google' | 'magic_link' = 'email',
  extra: Record<string, string | number | boolean> = {}
): Promise<void> {
  try {
    const mid = env.GA4_MEASUREMENT_ID
    const secret = env.GA4_API_SECRET
    if (!mid || !secret) return

    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${mid}&api_secret=${secret}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: `server_signup_${customerId}`,
          user_id: String(customerId),
          non_personalized_ads: true,
          events: [{
            name: 'sign_up',
            params: {
              method,
              category: 'user',
              customer_id: customerId,
              event_source: 'server',
              ...extra,
            },
          }],
        }),
      }
    )
  } catch (e: any) {
    console.error('[analytics-events] trackSignupEvent error:', e?.message)
  }
}
