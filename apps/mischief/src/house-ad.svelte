<script>
  let { href, label, line, link } = $props();
</script>

<aside class="workshop-callout" aria-label={label}>
  <span class="workshop-callout-mark" aria-hidden="true">🐀</span>
  <div class="workshop-callout-text">
    <strong>{label}</strong>
    <p>{line}</p>
  </div>
  <a href={href}>{link}</a>
</aside>
