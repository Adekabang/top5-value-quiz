<script lang="ts">
	import type { Phase1Question, Phase2Question, Phase1Option, Phase2Option } from '$lib/types';

	export let question: Phase1Question | Phase2Question;
	export let onAnswer: (selectedOption: Phase1Option | Phase2Option | Phase2Option[]) => void; // Callback for answer

	let selectedRanking: { [key: number]: Phase2Option } = {}; // For ranking questions

	function handleSimpleChoice(option: Phase1Option) {
		onAnswer(option);
	}

	function handleForcedChoice(option: Phase2Option) {
		onAnswer(option);
	}

	// Basic ranking selection (replace with drag-and-drop later if desired)
	function handleRankSelect(option: Phase2Option, rank: number) {
		// Remove option from other ranks if it exists
		Object.entries(selectedRanking).forEach(([r, opt]) => {
			if (opt === option && parseInt(r) !== rank) {
				delete selectedRanking[parseInt(r)];
			}
		});
		selectedRanking[rank] = option;
		selectedRanking = selectedRanking; // Trigger reactivity

		// Check if all ranks are filled
		if (Object.keys(selectedRanking).length === question.options.length) {
			// Create ordered array based on rank keys
			const rankedOptions = Object.entries(selectedRanking)
				.sort(([rankA], [rankB]) => parseInt(rankA) - parseInt(rankB))
				.map(([, opt]) => opt);
			onAnswer(rankedOptions);
			selectedRanking = {}; // Reset for next ranking question
		}
	}

	$: isRankingComplete =
		question.type === 'ranking' && Object.keys(selectedRanking).length === question.options.length;
</script>

<div class="card bg-base-100 my-4 w-full shadow-xl">
	<div class="card-body">
		<h2 class="card-title mb-4 text-lg md:text-xl">{question.text}</h2>

		{#if question.type === 'simple_choice'}
			<div class="flex flex-col space-y-3">
				{#each question.options as option (option.text)}
					<button class="btn btn-outline" on:click={() => handleSimpleChoice(option)}>
						{option.text}
					</button>
				{/each}
			</div>
		{:else if question.type === 'forced_choice'}
			<div class="flex flex-col space-y-3 sm:flex-row sm:justify-center sm:space-y-0 sm:space-x-4">
				{#each question.options as option (option.text)}
					<button class="btn btn-primary flex-1" on:click={() => handleForcedChoice(option)}>
						{option.text}
					</button>
				{/each}
			</div>
		{:else if question.type === 'ranking'}
			<p class="mb-3 text-center text-sm">Rank the following options (1 = Most Important):</p>
			<div class="grid grid-cols-1 md:grid-cols-{question.options.length} gap-4">
				{#each question.options as option (option.text)}
					<div class="bg-base-200 rounded-lg border p-3">
						<p class="mb-2 text-center font-semibold">{option.text}</p>
						<div class="flex justify-around">
							{#each Array(question.options.length) as _, i}
								{@const rank = i + 1}
								<button
									class="btn btn-sm btn-circle"
									class:btn-primary={selectedRanking[rank] === option}
									class:btn-outline={selectedRanking[rank] !== option}
									on:click={() => handleRankSelect(option, rank)}
									disabled={selectedRanking[rank] && selectedRanking[rank] !== option}
								>
									{rank}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			{#if isRankingComplete}
				<p class="text-success mt-4 text-center font-semibold">
					Ranking complete! Click anywhere to continue.
				</p>
				<!-- Note: Actual progression happens in the parent via onAnswer -->
			{/if}
		{/if}

		{#if question.type !== 'ranking'}
			<!-- Only show values for non-ranking for simplicity -->
			{#if 'values_being_compared' in question && question.values_being_compared}
				<div class="text-base-content/50 mt-4 text-center text-xs">
					Comparing: {question.values_being_compared.join(' vs ')}
				</div>
			{/if}
		{/if}
	</div>
</div>
