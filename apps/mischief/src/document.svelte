<script>
  let {
    bodyHtml,
    discoveryLinks,
    houseAdHtml = "",
    noindex = false,
    breadcrumbHref,
    breadcrumbLabel,
    breadcrumbName,
    description,
    ogImageUrl,
    origin,
    path,
    stylesheet,
    title,
  } = $props();

  const canonicalUrl = `${origin}${path}`;

</script>

<svelte:head>
  {@html `<style>${stylesheet}</style>`}
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  {#if noindex}<meta name="robots" content="noindex" />{/if}
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:site_name" content="ratstack.sh" />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content={description} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImageUrl} />
  <link rel="canonical" href={canonicalUrl} />
  {#each discoveryLinks as link}
    <link rel={link.rel} type={link.type} href={link.href} />
  {/each}
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<header>
  <nav aria-label="Primary navigation" class="site-nav">
    <a class="brand" href="/"><strong>🐀 Rat Stack</strong></a>
    <div class="site-links">
      <ul>
        <li><a href="/skills">skills</a></li>
        <li><a href="/lore">lore</a></li>
        <li><a href="/systems">systems</a></li>
        <li><a href="/glossary">glossary</a></li>
      </ul>
      <ul>
        <li><a href="/llms.txt">agent guide</a></li>
      </ul>
    </div>
  </nav>
</header>

<main>
  {#if path !== "/tokenmaxx"}
    <p class="agent-pointer visually-hidden" aria-hidden="true">
      For agents: start with the <a href="/llms.txt">agent guide</a>. Every page is also available as Markdown.
    </p>
  {/if}
  {@html houseAdHtml}
  {#if breadcrumbHref && breadcrumbLabel && breadcrumbName}
    <nav aria-label="Breadcrumb" class="breadcrumb">
      <a href={breadcrumbHref}>{breadcrumbLabel}</a> / {breadcrumbName}
    </nav>
  {/if}
  {@html bodyHtml}
</main>

<footer>
  <hr />
  <div class="site-reference">
    <section aria-label="Explore">
      <h2>Explore</h2>
      <ul>
        <li><a href="/glossary">glossary</a></li>
        <li><a href="/log">change log</a></li>
        <li><a href="/resources/peers.svx">peers</a></li>
      </ul>
    </section>
    <section aria-label="Reference">
      <h2>Reference</h2>
      <ul>
        <li><a href="/llms.txt">agent guide</a></li>
        <li><a href="/openapi.json">API docs</a></li>
        <li><a href="https://github.com/joelhooks/rat-stack">source</a></li>
      </ul>
    </section>
  </div>
  <p>
    Markdown by default. HTML when you ask for it.
    <a href="/llms.txt">Agents start here</a>.
  </p>
</footer>
