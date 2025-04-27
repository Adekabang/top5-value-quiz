<script lang="ts">
    import { valueScores, resetQuiz } from '$lib/stores';
    import type { ValueScores } from '$lib/types';

    export let finalScores: ValueScores;

    $: topValues = Object.entries(finalScores)
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort descending by score
        .slice(0, 5); // Take top 5

</script>

<div class="card w-full max-w-md bg-base-100 shadow-xl mx-auto">
    <div class="card-body items-center text-center">
        <h2 class="card-title text-2xl mb-4">Your Top 5 Professional Values</h2>
        {#if topValues.length > 0}
            <ul class="list-none p-0 text-lg space-y-2">
                {#each topValues as [value, score], index (value)}
                    <li class="p-2 rounded">
                       <span class="font-bold text-primary">{index + 1}. {value}</span>
                       <!-- Optional: Show score -->
                       <!-- <span class="text-sm text-base-content/60"> (Score: {score})</span> -->
                    </li>
                {/each}
            </ul>
        {:else}
            <p>Could not determine top values. Please try the quiz again.</p>
        {/if}

        <div class="card-actions justify-center mt-6">
            <button class="btn btn-primary" on:click={resetQuiz}>
                Restart Quiz
            </button>
        </div>
    </div>
</div>
