<script lang="ts">
	import { resetQuiz } from '$lib/stores';
	// *** Accept the evaluated list directly ***
	export let topValuesResult: string[] | null;
</script>

<div class="card bg-base-100 mx-auto w-full max-w-md shadow-xl">
	<div class="card-body items-center text-center">
		<h2 class="card-title mb-4 text-2xl">Your Top 5 Professional Values</h2>
		{#if topValuesResult && topValuesResult.length === 5}
			<p class="text-base-content/70 mb-4 text-sm">(Based on AI analysis of your choices)</p>
			<ul class="list-none space-y-2 p-0 text-lg">
				{#each topValuesResult as value, index (value)}
					<li class="rounded p-2">
						<span class="text-primary font-bold">{index + 1}. {value}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p>Could not determine top values. Please try the quiz again.</p>
			<!-- Optional: Add message if evaluation failed but scores exist -->
			<!-- <p>Evaluation failed. Showing results based on scores:</p> -->
			<!-- Add logic here to show score-based results as fallback if needed -->
		{/if}

		<div class="card-actions mt-6 justify-center">
			<button class="btn btn-primary" on:click={resetQuiz}> Restart Quiz </button>
		</div>
	</div>
</div>
