<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { ui } from '../lib/ui.svelte';
  import { sizeLabel } from '../lib/format';
  import type { SlackFile } from '../lib/slack/types';

  let { files }: { files: SlackFile[] } = $props();
  const isImage = (f: SlackFile) => !!f.thumb && (f.mimetype?.startsWith('image/') ?? true);
</script>

{#if files.length}
  <div class="files">
    {#each files as f (f.id)}
      {#if isImage(f)}
        <button
          class="img-file"
          aria-label="放大預覽 {f.name}"
          onclick={() => (ui.lightbox = { src: app.source.fileUrl(f.url_private || f.thumb!), name: f.title || f.name })}
        >
          <img
            src={app.source.fileUrl(f.thumb!)}
            alt={f.title || f.name}
            loading="lazy"
            width={f.thumb_w ?? undefined}
            height={f.thumb_h ?? undefined}
          />
        </button>
      {:else}
        <a class="doc-file" href={f.permalink ?? undefined} target="_blank" rel="noreferrer">
          <span class="ft">{f.filetype ?? 'file'}</span>
          <span style="min-width:0">
            <span class="fn">{f.title || f.name}</span>
            <small>{[f.filetype?.toUpperCase(), sizeLabel(f.size)].filter(Boolean).join(' · ')}</small>
          </span>
        </a>
      {/if}
    {/each}
  </div>
{/if}
