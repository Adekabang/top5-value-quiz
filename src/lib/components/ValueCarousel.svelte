<!-- src/lib/components/ValueCarousel.svelte -->
<script lang="ts">
	import { PROFESSIONAL_VALUES } from '$lib/constants';
	import { onMount } from 'svelte';

	const NUM_REELS = 3;
	let speeds = Array(NUM_REELS).fill(0);
	let positions = Array(NUM_REELS).fill(0);
	let spinning = Array(NUM_REELS).fill(false);
	let animationFrames = Array(NUM_REELS).fill(null);

	function shuffleArray(array: string[]) {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	const reelValues = Array(NUM_REELS)
		.fill(null)
		.map(() => shuffleArray(PROFESSIONAL_VALUES));

	function spinReel(reelIndex: number, initialDelay = 0) {
		if (spinning[reelIndex]) return;

		setTimeout(() => {
			spinning[reelIndex] = true;
			speeds[reelIndex] = 0;
			let acceleration = 0.0001; // Much slower acceleration
			let maxSpeed = 0.8; // Much slower max speed
			let running = true;

			function animate() {
				if (!running) return;

				if (speeds[reelIndex] < maxSpeed) {
					speeds[reelIndex] = Math.min(maxSpeed, speeds[reelIndex] + acceleration);
				}

				positions[reelIndex] =
					(positions[reelIndex] + speeds[reelIndex]) % PROFESSIONAL_VALUES.length;
				positions = [...positions];

				animationFrames[reelIndex] = requestAnimationFrame(animate);
			}

			animate();

			setTimeout(
				() => {
					running = false;
					let slowdown = () => {
						speeds[reelIndex] *= 0.98; // Even slower deceleration
						positions[reelIndex] =
							(positions[reelIndex] + speeds[reelIndex]) % PROFESSIONAL_VALUES.length;
						positions = [...positions];

						if (speeds[reelIndex] > 0.02) {
							animationFrames[reelIndex] = requestAnimationFrame(slowdown);
						} else {
							positions[reelIndex] = Math.round(positions[reelIndex]);
							positions = [...positions];
							spinning[reelIndex] = false;

							// Start all reels again after the last one stops
							if (reelIndex === NUM_REELS - 1) {
								setTimeout(startSpinSequence, 3000); // Longer pause between sequences
							}
						}
					};
					slowdown();
				},
				4000 + Math.random() * 2000 // Longer spin time
			);
		}, initialDelay);
	}

	function startSpinSequence() {
		// Start all reels simultaneously
		for (let i = 0; i < NUM_REELS; i++) {
			spinReel(i, 0);
		}

		// Schedule sequential stopping
		for (let i = 0; i < NUM_REELS; i++) {
			setTimeout(
				() => {
					if (spinning[i]) {
						speeds[i] = Math.min(speeds[i], 10); // Slow down for stopping
					}
				},
				3000 + i * 800
			); // Start stopping sequence after 3s, with 800ms between each reel
		}
	}

	onMount(() => {
		setTimeout(startSpinSequence, 1000);

		return () => {
			animationFrames.forEach((frame) => {
				if (frame) cancelAnimationFrame(frame);
			});
		};
	});

	// Calculate visual position for each value
	function getValuePosition(basePos: number, index: number, total: number) {
		const relativePos = (index - basePos + total) % total;
		return relativePos < 3 ? relativePos : relativePos > total - 3 ? relativePos - total : null;
	}
</script>

<div class="relative w-full overflow-hidden py-4 text-center">
	{#each Array(NUM_REELS) as _, reelIndex}
		<div
			class="bg-base-200 relative mb-2 h-14 overflow-hidden rounded-lg shadow-inner"
			style="opacity: {1 - reelIndex * 0.1}"
		>
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="relative h-full w-80">
					<!-- Wider container -->
					{#each reelValues[reelIndex] as value, valueIndex}
						{@const position = getValuePosition(
							positions[reelIndex],
							valueIndex,
							PROFESSIONAL_VALUES.length
						)}
						{#if position !== null}
							<span
								class="absolute left-1/2 min-w-56 -translate-x-1/2 text-2xl font-bold transition-transform"
								style="
									transform: translate({position * 140}%, -50%); /* Increased spacing */
									color: {position === 0 ? 'var(--primary)' : 'inherit'};
									opacity: {1 - Math.abs(position) * 0.4}; /* More fade for side values */
									transition-duration: {spinning[reelIndex] ? '0s' : '0.5s'};
								"
							>
								{value}
							</span>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	span {
		pointer-events: none;
		user-select: none;
		white-space: nowrap;
		top: 50%;
	}
</style>
