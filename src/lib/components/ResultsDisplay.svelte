<script lang="ts">
	import { resetQuiz } from '$lib/stores';
	// *** Import ValueScores type ***
	import type { ValueScores } from '$lib/types';

	// Accept the evaluated list directly
	export let topValuesResult: string[] | null;
	// *** Accept the final scores ***
	export let finalScores: ValueScores;
	// *** NEW: Accept review text ***
	export let reviewText: string | null;

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

<div class="card bg-base-100 mx-auto w-full max-w-2xl shadow-xl">
	<div class="card-body items-center text-center">
		<h2 class="card-title mb-4 text-2xl">Your Top 5 Professional Values</h2>
		{#if sortedTopValues && sortedTopValues.length === 5}
			<!-- Top 5 List -->
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

			<!-- *** NEW: Display Review Text *** -->
			{#if reviewText}
				<div class="divider my-4">Why These Values?</div>
				<!-- Use prose for better text formatting, text-left for readability -->
				<p class="prose prose-sm text-base-content/80 text-justify">
					{@html reviewText.replace(/\n/g, '<br/>')}
					<!-- Basic formatting for newlines -->
				</p>
			{:else}
				<!-- Optional: Show placeholder if review is missing/failed -->
				<p class="text-base-content/50 mt-4 text-sm italic">
					Insights generation failed or is pending.
				</p>
			{/if}
		{:else}
			<p>Could not determine top values. Please try the quiz again.</p>
		{/if}

		<div class="card-actions mt-6 justify-center">
			<button class="btn btn-primary" on:click={resetQuiz}> Restart Quiz </button>
		</div>
	</div>
</div>
