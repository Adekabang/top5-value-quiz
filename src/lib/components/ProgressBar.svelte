<script lang="ts">
  export let current: number;
  export let total: number;
  export let phase: string; // e.g., "Phase 1", "Phase 2"

  $: progressValue = total > 0 ? (current / total) * 100 : 0;
</script>

<div class="my-4 w-full max-w-xl mx-auto px-4">
    <div class="flex justify-between text-sm mb-1">
        <span>{phase}</span>
        <span>Question {current} of {total}</span>
    </div>
  <progress class="progress progress-primary w-full" value={progressValue} max="100"></progress>
</div>
