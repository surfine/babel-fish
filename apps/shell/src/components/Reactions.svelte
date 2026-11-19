<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { emojiChar } from '../lib/emoji';
  import { ICON } from '../lib/icons';
  import { ui, anchorOf } from '../lib/ui.svelte';
  import type { Message } from '../lib/slack/types';

  let { channel, m }: { channel: string; m: Message } = $props();

  const who = (users: string[]) => users.map((u) => (u === app.self?.id ? '你' : app.name(u))).join('、');
  function pick(e: MouseEvent) {
    ui.picker = { anchor: anchorOf(e.currentTarget as Element), onPick: (name) => app.toggleReaction(channel, m, name) };
  }
</script>

{#if m.reactions.length}
  <div class="reactions">
    {#each m.reactions as r (r.name)}
      {@const ch = emojiChar(r.name)}
      {@const url = ch ? null : app.customEmoji[r.name.split('::')[0]]}
      <button
        class="rx"
        class:me={r.me}
        title="{who(r.users)} 回應了 :{r.name}:"
        aria-pressed={r.me}
        disabled={app.readOnly}
        onclick={() => app.toggleReaction(channel, m, r.name)}
      >
        {#if ch}<span class="emoji">{ch}</span>{:else if url}<img class="emoji" src={url} alt=":{r.name}:" />{:else}:{r.name}:{/if}
        <b>{r.count}</b>
      </button>
    {/each}
    {#if !app.readOnly}<button class="rx add" aria-label="新增表情回應" onclick={pick}>{@html ICON.smileSm}＋</button>{/if}
  </div>
{/if}
