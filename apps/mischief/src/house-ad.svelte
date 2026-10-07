<script>
  let { href, label, line, link } = $props();
</script>

<aside class="workshop-callout" aria-label={label}>
  <span class="workshop-callout-label">{label}</span>
  <span class="workshop-callout-title">{line}</span>
  <span class="workshop-callout-action">
    <a class="workshop-callout-apply" href={href}
      >{link}<svg
        aria-hidden="true"
        class="icon"
        fill="none"
        height="16"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
        width="16"
        ><path
          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      ></a
    >
  </span>
</aside>
