<script lang="ts">
  import CodeCard from './CodeCard.svelte';

  // How to put the app on the iPhone Home Screen, which is what makes notifications possible.
</script>

<ol class="steps">
  <li>
    <span class="n">1</span>
    <div>
      Tap <b>Share</b>
      <svg class="share" viewBox="0 0 24 24" width="20" height="20" aria-label="the Share button"><path d="M12 15V3m0 0L8 7m4-4 4 4M7 10H5v11h14V10h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      in Safari’s toolbar (on newer iPhones, tap <b>•••</b> first).
    </div>
  </li>
  <li><span class="n">2</span><div>Choose <b>Add to Home Screen</b>, keep <b>Open as Web App</b> on, then tap <b>Add</b>.</div></li>
  <li><span class="n">3</span><div>Open <b>Nest</b> from your Home Screen. It keeps its own sign-in, so tap <b>I have a code</b> and type this:</div></li>
</ol>
<CodeCard />
<p class="small muted">Then in the app: More → Settings → Turn on notifications. Reminders arrive with the phone locked, just like any other app.</p>

<style>
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 14px;
  }
  li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .n {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 14px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
    display: grid;
    place-items: center;
    font-size: 0.875rem;
  }
  .share {
    vertical-align: -4px;
    color: var(--accent-ink);
  }
  p {
    margin: 0;
  }
</style>
