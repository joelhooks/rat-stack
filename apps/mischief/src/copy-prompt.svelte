<script>
  let { label, showText = false, text, variant } = $props();
</script>

{#snippet control()}
  <span class="copy-actions">
    <button type="button" class:copy-primary={variant === "primary"} class="copy" data-text={text} aria-label={label} hidden>
      <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2m16 0h2m-7-1v2m-6-2v2" /></svg>
      <svg class="icon icon-done" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" hidden><path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="copy-label">{label}</span>
    </button>
    <span class="copy-status" role="status" aria-live="polite"></span>
  </span>
{/snippet}

{#if variant === "text"}
  <div class="prompt">
    <details class="prompt-text">
      <summary>See the prompt</summary>
      <pre><code>{text}</code></pre>
    </details>
  </div>
{:else if showText}
  <div class="prompt">
    {@render control()}
    <details class="prompt-text">
      <summary>See the prompt</summary>
      <pre><code>{text}</code></pre>
    </details>
  </div>
{:else}
  {@render control()}
{/if}
