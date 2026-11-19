<script lang="ts">
  // 連結預覽：照官方 Slack 的卡片（網站名、標題、摘要、縮圖或大圖）。點標題用預設瀏覽器打開。
  import type { LinkPreview } from '../lib/slack/types';

  let { previews }: { previews: LinkPreview[] } = $props();
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  const hide = (e: Event) => ((e.currentTarget as HTMLElement).style.display = 'none');
</script>

{#each previews as p (p.url)}
  <div class="unfurl" data-raw>
    <div class="u-body">
      <div class="u-site">
        {#if p.service_icon}<img class="u-icon" src={p.service_icon} alt="" onerror={hide} />{/if}
        <span>{p.service ?? host(p.url)}</span>
      </div>
      {#if p.title}<a class="u-title" href={p.url} target="_blank" rel="noreferrer">{p.title}</a>{/if}
      {#if p.text}<p class="u-text">{p.text}</p>{/if}
      {#if p.image}
        <img
          class="u-image"
          src={p.image}
          alt=""
          loading="lazy"
          style:aspect-ratio={p.image_w && p.image_h ? `${p.image_w} / ${p.image_h}` : undefined}
          onerror={hide}
        />
      {/if}
    </div>
    {#if p.thumb}<img class="u-thumb" src={p.thumb} alt="" loading="lazy" onerror={hide} />{/if}
  </div>
{/each}

<style>
  .unfurl {
    display: flex;
    gap: 12px;
    margin-top: 6px;
    max-width: 520px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--bg);
  }
  .u-body {
    min-width: 0;
    flex: 1;
  }
  .u-site {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-3);
  }
  .u-icon {
    width: 16px;
    height: 16px;
    border-radius: 3px;
  }
  .u-title {
    display: block;
    margin-top: 2px;
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .u-title:hover {
    text-decoration: underline;
  }
  .u-text {
    margin: 2px 0 0;
    font-size: 14px;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
  }
  .u-image {
    display: block;
    margin-top: 8px;
    max-width: 100%;
    max-height: 280px;
    border-radius: 8px;
    object-fit: cover;
  }
  .u-thumb {
    width: 80px;
    height: 80px;
    border-radius: 8px;
    object-fit: cover;
    flex: none;
  }
</style>
