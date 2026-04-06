/**
 * Video Orchestrator Service
 * Port from ACS_ContentEngine video-orchestrator.ts
 * Phase 1: Storyboard timeline builder for client-side CSS preview.
 * Phase 2 (future): Server-side FFmpeg MP4 rendering.
 */

/**
 * Build a storyboard timeline from a proposal object.
 * @param {object} proposal - with trend.recipe and matched_assets
 * @returns {object} StoryboardTimeline
 */
export function buildStoryboardTimeline(proposal) {
  const recipe = proposal.trend?.recipe;
  if (!recipe) {
    return { frames: [], total_duration_sec: 0, aspect_ratio: '9:16', audio_suggestion: null };
  }

  const frames = [];

  for (let i = 0; i < recipe.slots.length; i++) {
    const slot = recipe.slots[i];
    const matchedAsset = proposal.matched_assets?.[i];
    const assetUrl = matchedAsset?.asset?.public_url || '';

    // Find text overlay for this time window
    let currentTime = 0;
    for (let j = 0; j < i; j++) {
      currentTime += recipe.slots[j].duration_sec;
    }

    const overlay = recipe.text_overlays?.find(
      t => t.appear_at_sec >= currentTime && t.appear_at_sec < currentTime + slot.duration_sec
    ) || null;

    frames.push({
      slot_label: slot.label,
      asset_url: assetUrl,
      asset_id: matchedAsset?.asset_id || null,
      duration_sec: slot.duration_sec,
      transition_in: i === 0 ? 'none' : recipe.transition,
      text_overlay: overlay,
      vibes: slot.vibes || [],
    });
  }

  return {
    frames,
    total_duration_sec: recipe.total_duration_sec,
    aspect_ratio: '9:16',
    audio_suggestion: recipe.audio_suggestion || null,
    audio_mix: recipe.audio_mix || 'mute',
    transition: recipe.transition || 'crossfade',
  };
}
