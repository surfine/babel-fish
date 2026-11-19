<script lang="ts">
  import { app } from '../lib/store.svelte';

  let { user, cls = 'avatar' }: { user?: string | null; cls?: string } = $props();
  const u = $derived(user ? app.users[user] : undefined);
  const label = $derived(user ? app.name(user) : '?');
  const ini = $derived(
    label
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );
  const bg = $derived(u?.color ? '#' + u.color : '#64748b');
</script>

<span class={cls} style:background={bg} aria-hidden="true">
  {#if u?.avatar}<img src={u.avatar} alt="" loading="lazy" />{:else}{ini}{/if}
</span>
