<script>
  let { href, label, line, link } = $props();
</script>

<aside class="workshop-callout" aria-label={label}>
  <span class="workshop-callout-label">{label}</span>
  <span class="workshop-callout-title">{line}</span>
  <a href={href}>{link}</a>
</aside>
