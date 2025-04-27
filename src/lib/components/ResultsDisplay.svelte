<script lang="ts">
	import { resetQuiz } from '$lib/stores';
	// *** Import ValueScores type ***
	import type { ValueScores } from '$lib/types';

	// Accept the evaluated list directly
	export let topValuesResult: string[] | null;
	// *** Accept the final scores ***
	export let finalScores: ValueScores;

	// *** Reactive statement to sort the AI's list based on scores ***
	$: sortedTopValues = topValuesResult
		? [...topValuesResult].sort((valueA, valueB) => {
				// Get scores, default to 0 if somehow missing (shouldn't happen)
				const scoreA = finalScores[valueA] ?? 0;
				const scoreB = finalScores[valueB] ?? 0;
				// Sort descending (highest score first)
				return scoreB - scoreA;
			})
		: null;
</script>

<div class="card bg-base-100 mx-auto w-full max-w-md shadow-xl">
	<div class="card-body items-center text-center">
		<h2 class="card-title mb-4 text-2xl">Your Top 5 Professional Values</h2>
		{#if sortedTopValues && sortedTopValues.length === 5}
			<p class="text-base-content/70 mb-4 text-sm">(Based on AI analysis of your choices)</p>
			<ul class="list-none space-y-2 p-0 text-lg">
				<!-- *** Iterate over the SORTED list *** -->
				{#each sortedTopValues as value, index (value)}
					<li class="rounded p-2">
						<span class="text-primary font-bold">{index + 1}. {value}</span>
						<!-- Optional: Show score for clarity -->
						<span class="text-base-content/60 text-sm">
							(Score: {finalScores[value] ?? 'N/A'})</span
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p>Could not determine top values. Please try the quiz again.</p>
		{/if}

		<div class="card-actions mt-6 justify-center">
			<button class="btn btn-primary" on:click={resetQuiz}> Restart Quiz </button>
		</div>
	</div>
</div>
