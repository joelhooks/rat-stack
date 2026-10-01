<script>
  let { href, label, line, link } = $props();
</script>

<aside class="house-ad" aria-label={label}>
  <span class="house-ad-rat" aria-hidden="true">🐀</span>
  <div class="house-ad-message">
    <strong>{label}</strong>
    <p>{line}</p>
  </div>
  <a href={href}>{link}</a>
</aside>
