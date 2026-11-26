import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const ALIGNMENT_GUIDE_URI = 'lazulite://guides/alignment-and-segmentation';
export const WORKFLOW_INSTRUCTIONS = `Use this workflow unless the user specifies a different scope or segmentation: acquire/import lyrics, split body words, assign and split readings, select/separate vocals, run whole-song alignment, diagnose anomalies, refine with a different model, then inspect acoustics, spectrograms and listening samples.

Do not skip body segmentation just because the user did not request it. Japanese: split pure kana and okurigana away from kanji; split kana body and ruby by mora (split_cjk=true, japanese_mora=true). Split multi-kanji words when readings correspond to individual characters, even if the analyzer proposed a whole word: 景色 → 景(け) + 色(し,き); 世界 → 世(せ) + 界(か,い). Retain inseparable jukujikun/ateji bodies, e.g. 今日(きょ,う), 大人(お,と,な), while splitting their ruby into mora. Prefer set_line_spans or split_and_set_word to preserve explicit body/reading correspondence. Chinese, Cantonese and dialect lyrics: split body into characters (split_cjk=true) and assign dictionary readings per character. Western/English text: western='word'; use syllables only when requested. Segment body first, then readings. Existing ruby words can be skipped while remaining body words are split; inspect changed/skipped/blocked counts.

Keep audio_source='vocals', crop_vocals=true, line_blank=false, rest_blank=false and rest_token=false. Japanese first pass: choose an available NextFire catalog ID with convert_particles=true, latin_normalize=true, smart_extend=false. Use demucs for speed; for strong lead/backing-vocal overlap or high quality, select bs-karaoke if ready via start_vocal_separation(model_id='bs-karaoke'), then list_vocal_results(detail='full') and adopt the ready result via edit_acoustics(analysis_id=<result ID>, operations=[replace_segments with its segments]) before alignment, then acknowledge_job(state='applied'). Chinese/dialects/mixed languages: prefer MMS_FA with smart_extend=true; enable strip_tone_digits=true for numbered tones.

Never repeat local alignment with the same model or retry the same model by switching original/vocal audio. After Japanese NextFire alignment, inspect_alignment_anomalies selects candidate rows. Read get_acoustics (include_energy=true if useful), check adjacent pronunciation and silence, and only when needed use edit_timing(set_line_time) to widen a safe row envelope. Local windows have NO automatic padding. Switch to MMS_FA + smart_extend=true using scope_line_ids or scope_word_ids; preview and submit matching scope/options/revision. Each local scope is one continuous [min, max] audio window. Split discontiguous targets into independent tasks; use a single row or consecutive adjacent rows, preview, submit and apply each in turn. preview_alignment returns envelope_ms and optional warnings; inspect both before submitting. Missing timings require repair, not blind recomputation.

inspect_alignment_anomalies is only an auxiliary candidate screen for NextFire short units and same-vowel imbalance, not a complete error list. Actively inspect sustained units >1,000 ms for premature tail closure, lead/backing overlap and reverb, silence/interlude segment boundaries, and multilingual or incorrect readings even when the scan is clean. Use get_timeline_visual (which plots vocal RMS energy above the spectrogram when ready vocal analysis exists) with get_acoustics; read the numbered units mapping alongside the energy curve and spectrogram to locate exact boundaries. When verifying a local refinement or comparing two candidate models on the same saved revision, run alignment jobs without applying them first, call compare_alignment_results(project_id, job_ids=[...]) to inspect current_saved vs candidate tracks and boundary divergences (default 80 ms), then apply_alignment_result on the chosen job (and optionally acknowledge_job(dismissed) on unused candidates). Models without audio input can review the image; complement with get_audio_excerpt when listening is supported. Check long harmonic tails visually and adjust exact endpoints via edit_timing; fix reading or acoustic segment problems before cross-model local recomputation.

Use expected_revision/If-Match semantics, poll background jobs and apply results explicitly. Read ${ALIGNMENT_GUIDE_URI} for parameter tables, benchmark context and examples.`;

export const ALIGNMENT_GUIDE = `# Alignment and segmentation reference

Benchmark reference: M1–M9, 2026-11-26. Figures below describe the experimental corpus and hardware, not a per-song guarantee. Japanese M8: 20 songs, 875 body rows, 8,909 kana reading units; cross-language M2: six songs, 1,957 common body intervals.

## Vocal separation

| model_id | Choice | Measured cost and downstream result |
| --- | --- | --- |
| demucs | Default fast separation | Five-song GPU total 13.53 s; 30-second CPU excerpt 9.04 s; Japanese NextFire 84.51% at both endpoints within 100 ms |
| bs-karaoke | Lead/backing-vocal overlap, high quality when ready | Five-song GPU total 212.04 s (~15.7× Demucs); CPU excerpt 208.43 s (~23×); Japanese 86.59%, overlapping sections ~83.47%–85.17% vs ~78%–79% |

Use list_vocal_models IDs. Explicit model_id reuses only same-model audio; omitted model_id first reuses any available result, otherwise uses the desktop preference. force_separation=true explicitly recomputes. Use list_vocal_results(detail='full') and edit_acoustics(analysis_id=<result ID>, operations=[{op:'replace_segments',segments:<result segments mapped to begin_ms/end_ms/id>}]) to select the ready analysis for alignment; a separation job alone does not change the saved project's active analysis. Keep audio_source='vocals', crop_vocals=true: active/core segment concatenation improved endpoint accuracy by 2.63–10.16 percentage points over whole-song input (M3/M5).

## Alignment matrix

| Language / stage | Model family (resolve installed ID from list_alignment_models) | Parameters |
| --- | --- | --- |
| Japanese first whole-song pass | NextFire | convert_particles=true, latin_normalize=true, smart_extend=false |
| Japanese flagged-row refinement after NextFire | MMS_FA | smart_extend=true, latin_normalize=true; use scope_line_ids / scope_word_ids |
| Chinese / Cantonese / Teochew / mixed | MMS_FA | smart_extend=true; strip_tone_digits=true when readings contain tone digits |
| English / other Western text | MMS_FA as the multilingual starting choice | latin_normalize=true; body western='word'; inspect preview unknowns and listen |

Every row: audio_source='vocals', crop_vocals=true; line_blank=false, rest_blank=false, rest_token=false. M7 found blank/rest heuristics negligible or negative; same-model original/vocal retry reduced accuracy. M2 multilingual MMS_FA reached 82.42%–82.83%, compared with NextFire 46.40%–49.72%. English guidance is a multilingual starting choice, not an English-specific benchmark result.

## M8 anomaly selection and safe local windows

- balanced: complete, positive-duration leaf < short_threshold_ms (default 40), OR adjacent same-reading/vowel imbalance.
- conservative: only adjacent same-reading/vowel imbalance (plus missing/invalid timing diagnostics for repair).
- Adjacent matching: normalized romaji identical, OR the left romaji ends in a vowel and right romaji begins with that same vowel. Let short=min(d1,d2), long=max(d1,d2): imbalance if short<40 ms OR (short<80 ms AND long>=4*short). Missing/invalid endpoints are reported separately and do not provide a valid pair duration.
- conservative selected ~9% of experimental rows; cross-model local refinement reached 85.24% (Demucs) / 87.46% (BS Karaoke). balanced selected 21.49%–24.46%; local refinement reached 85.81% / 87.72%. These triggers predict candidates, not certain errors.
- Same-model NextFire local retries lost 19–125 hits across tested rules. Never use them as the refinement route.
- The experiment padded local windows by ±300 ms. Studio uses strictly unpadded union envelopes, so these scores are reference evidence, not a claim of reproduced Studio results.
- Row scope includes row, body-word and ruby endpoints; word scope includes selected word and ruby endpoints. Direct scope_ids uses leaf times. Read get_acoustics and neighboring rows before edit_timing(set_line_time) adds any margin. Keep the widened window inside the source and away from adjacent pronunciation. Start uses scope_line_ids=[...] or scope_word_ids=[...], mutually exclusive with scope_ids. A local selection needs at least two reading leaves.
- Keep revision/options/scopes consistent between preview_alignment and start_alignment; poll get_job_status and apply_alignment_result, then inspect/listen again. Do not repeatedly refine an already-refined row using the same model.

## Continuous local windows and image review

Every local selection spans ONE continuous [min, max] audio envelope. Discontiguous line/word targets also include unrelated intermediate audio. Split them into independent tasks, each covering a single row or consecutive adjacent rows. For example, repair L2 and L9 by preview_alignment(scope_line_ids=[L2]), start_alignment with the same revision/options and apply_alignment_result; read the new revision, then preview/start/apply L9 separately. Do not combine [L2,L9] into one request. Inspect preview envelope_ms and warnings before every launch.

get_timeline_visual(project_id, line_id, padding_ms=500) returns a compact PNG plus text JSON. Alternatively provide start_ms/end_ms for an explicit window up to 15,000 ms. A line window clamps to source duration and 15 seconds; use explicit smaller windows to inspect the remainder of a long line. When source='vocal' and the selected vocal result is ready, the image plots the Studio main_rms vocal energy curve directly above the 80–8000 Hz logarithmic spectrogram, followed by saved vocal activity, L1/L2 line ranges, alternating reading-leaf blocks and gaps/overlaps. Match each short number to the units entry with the same 1-based index field for unit_id, word_id, line_id, text and exact millisecond endpoints. The JSON actual_range_ms is authoritative. source='vocal' uses the saved selected result; vocal_result_id selects another available result, or choose source='original'. segments_in_window always describes the saved project's acoustic segments, even when viewing another result. Use get_acoustics and get_audio_excerpt as complementary evidence.

compare_alignment_results(project_id, job_ids=[...], line_id or start_ms/end_ms, divergence_threshold_ms=80) compares the current saved timeline (CUR) against 1 or 2 succeeded, unapplied alignment jobs bound to the same current revision. It runs mergeAlignment in memory using each job's saved options without modifying the document, plots vocal RMS energy, shared spectrogram, CUR/A/(B) tracks and divergent boundary markers, and returns per-unit timings, deltas, in_scope flags and job condition differences. Divergence indicates model disagreement rather than automatic ground truth; confirm visually before calling apply_alignment_result, and optionally call acknowledge_job(state='dismissed') on unchosen jobs.

## Common large errors and repair paths

inspect_alignment_anomalies is an auxiliary screen for short units/same-vowel imbalance and missing/invalid times, not a complete error list. Review these cases even if it returns no candidates:

| Source / corpus evidence | What to inspect | Repair path |
| --- | --- | --- |
| M8: NextFire short units / same-vowel compression | Adjacent numbered leaves and acoustic onset spacing | Switch to MMS_FA + smart_extend=true, one continuous local scope at a time |
| M4: sustained units >1,000 ms, especially phrase endings; both-endpoint 100 ms hit rate 47.24%–62.21% | Harmonic tail, fading endpoint, premature closure beyond saved end_ms | After spectrogram review, edit_timing the endpoint directly; keep ruby edits within the parent word (adjust parent first if needed) |
| M1/M4/M5: backing-vocal overlap / heavy reverb | Lead onset and tail versus background harmonics; compare separation sources | If ready, select BS Karaoke lead separation; inspect visually before local cross-model recomputation or endpoint edits |
| M3/M5: silence/interlude or fragmented vocal segment boundaries | get_acoustics and spectrogram around first/last sung rows, weak breaths and instrumental bleed | Correct saved segments or safe row envelope, then cross-model refinement when needed |
| M2: multilingual words, rare readings or segmentation/ruby mismatch | preview_alignment unknowns, text/readings, and the pictured onset sequence | Fix body/reading correspondence first, then use multilingual MMS_FA + smart_extend=true |

Image review and direct edit_timing are useful for an isolated onset/tail; cross-model recomputation suits a row with compressed or displaced units. Reinspect the changed revision, and report uncertainty requiring listening or human review.

## Default segmentation and reading correspondence

| Input | Body and ruby |
| --- | --- |
| 食べる | 食(た) + べ + る: split okurigana from kanji and kana body into mora |
| 景色 | 景(け) + 色(し,き): separable multi-kanji reading |
| 世界 | 世(せ) + 界(か,い): split characters, then multi-mora ruby |
| 今日 / 大人 | 今日(きょ,う) / 大人(お,と,な): inseparable jukujikun/ateji body, mora ruby |
| Chinese / Cantonese / dialect | Single body characters with corresponding dictionary readings |
| Western / English | Body words by default; syllables on user request |

Use segment_lyrics(target='words') before readings; split_cjk=true, japanese_mora=true for Japanese and western='word'. Apply analyzer proposals through apply_readings(set_line_spans / split_and_set_word), checking kanji/okurigana and separable compounds. Then segment_lyrics(target='ruby'). Do not merely split ruby while leaving a splittable body merged. dry_run defaults true: explicitly apply with dry_run=false after checking the preview. skip_existing_ruby=true preserves existing ruby words while splitting others; inspect skipped_existing_ruby_count and blocked_count.

## Editing and completion

edit_lyrics(delete_ruby) removes one reading leaf. edit_timing set_*_time with begin_ms=null/end_ms=null clears that object's endpoints; clear_line_timing/clear_word_timing also clear descendant words/ruby. Use edit_acoustics for saved segment edits and get_karaoke_cues/edit_karaoke_cues for guide cues. Save atomically with expected_revision; on conflicts reload and review before retrying. Inspect get_timeline_visual with its numbered JSON mapping and listen with get_audio_excerpt; report remaining human/model checks. batch_edit_lyrics smooth operates on the inline word/ruby reading-leaf stream, defaults to CJK, and include_non_cjk=true includes romanized readings/Western words while skipping whitespace and punctuation. It synchronizes ruby parent word envelopes; edit_timing set_ruby_time retains its parent-word bounds.
`;

export function registerGuidance(server: McpServer) {
  server.registerResource('alignment-and-segmentation',ALIGNMENT_GUIDE_URI,{description:'Language/model parameters, M1–M9 evidence, default segmentation and M8 cross-model refinement rules.',mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:ALIGNMENT_GUIDE}]}));
  server.registerPrompt('full_lyric_workflow',{
    description:'Complete lyric preparation, language-aware alignment and cross-model review workflow.',
    argsSchema:{project_id:z.string().min(1),language:z.enum(['ja','zh','yue','teochew','mixed','en']).optional(),quality:z.enum(['fast','high']).optional()},
  },async({project_id,language,quality})=>({messages:[{role:'user',content:{type:'text',text:`Run the full lyric workflow for project_id=${JSON.stringify(project_id)}, language=${language??'infer from lyrics'}, quality=${quality??'high'}.
1. Read get_project_summary and get_lyrics; acquire/import lyrics if needed. Read ${ALIGNMENT_GUIDE_URI}.
2. Preview segment_lyrics(target='words', scope={all:true}) with split_cjk=true, japanese_mora=true for Japanese, western='word'; inspect and apply dry_run=false.
3. Japanese: analyze_japanese_reading, then apply_readings using set_line_spans/split_and_set_word. Split kanji from okurigana and separable compounds 景色/世界; retain inseparable 今日/大人. Chinese/dialects: list_dictionaries, analyze_dictionary_reading and apply_readings per character. Split Japanese ruby mora with segment_lyrics(target='ruby'), explicitly apply. Verify body segmentation as well as ruby.
4. list_vocal_models; choose demucs for speed or ready bs-karaoke for strong overlap/high-quality Japanese. start_vocal_separation(model_id=...). Poll get_job_status; list_vocal_results(detail='full'), then edit_acoustics(analysis_id=<ready result ID>, operations=[{op:'replace_segments',segments:<that result's begin_ms/end_ms/id segments>}]) to adopt it before alignment; acknowledge_job(state='applied') after the CAS save succeeds.
5. list_alignment_models; Japanese first-pass NextFire (convert_particles=true, latin_normalize=true, smart_extend=false); Chinese/dialects/mixed use MMS_FA+smart_extend=true (strip_tone_digits=true for tone numbers). English: start with multilingual MMS_FA and inspect unknown input. Keep audio_source='vocals', crop_vocals=true, all blank/rest heuristics false.
6. preview_alignment, start_alignment with matching revision/options, poll get_job_status, apply_alignment_result. Resolve revision conflicts by re-reading and previewing.
7. After Japanese NextFire, inspect_alignment_anomalies(mode='${quality==='fast'?'conservative':'balanced'}'). For each flagged row inspect get_acoustics and neighboring pronunciation; use edit_timing(set_line_time) only if a safe envelope adjustment is needed. Switch to MMS_FA+smart_extend=true for preview_alignment/start_alignment(scope_line_ids=[...]); scope_word_ids is available for word selections. Each scope uses one continuous [min, max] window: split discontiguous targets into independent tasks covering a single row or consecutive adjacent rows; preview, submit and apply each in turn, checking envelope_ms/warnings. Never repeat the same model locally or retry it on original/vocal audio.
8. Treat inspect_alignment_anomalies as an auxiliary screen, not a complete error list. Proactively inspect get_timeline_visual plus its numbered units mapping and get_acoustics for sustained units >1,000 ms (tail closure), lead/backing overlap/reverb, silence/interlude boundaries and multilingual/reading errors, including unflagged rows. Use direct edit_timing for isolated pictured boundary errors or fix readings/segments before cross-model refinement. Review optional guide cues and get_audio_excerpt samples when audio input is supported. Report applied revisions and outstanding listening checks.`}}]}));
  server.registerPrompt('refine_alignment_anomalies',{
    description:'Refine Japanese NextFire anomalies using acoustics and a different MMS_FA model without automatic padding.',
    argsSchema:{project_id:z.string().min(1),mode:z.enum(['balanced','conservative']).optional()},
  },async({project_id,mode})=>({messages:[{role:'user',content:{type:'text',text:`Refine project_id=${JSON.stringify(project_id)} after its Japanese NextFire whole-song pass.
1. Read get_project_summary/get_lyrics and ${ALIGNMENT_GUIDE_URI}; confirm the previous model. If the project was already aligned with MMS_FA, do not blindly repeat MMS_FA locally.
2. inspect_alignment_anomalies(mode='${mode??'balanced'}') is only an auxiliary candidate screen, not a complete error list. Repair missing/invalid timing separately. Include unflagged sustained units >1,000 ms, lead/backing overlap/reverb, silence/interlude boundaries and multilingual/reading errors in the review.
3. For each candidate and the unflagged risk cases, use get_timeline_visual with its numbered units mapping plus get_acoustics(include_energy=true when available), and inspect neighboring row times. For an isolated onset/tail error use edit_timing directly after image review; fix readings/segments before recomputing a displaced row. Only if needed use edit_timing(set_line_time) to add a precise safe margin, inside source duration and excluding neighbors. Studio never pads local windows automatically.
4. list_alignment_models and choose a ready MMS_FA ID. preview_alignment(scope_line_ids=[...],model_id=<catalog MMS_FA ID>); then start_alignment with the same scope/revision/model_preview, smart_extend=true, audio_source='vocals',crop_vocals=true,latin_normalize=true,line_blank=false,rest_blank=false,rest_token=false. Use the same normalization options for preview and start. Re-preview after any edit.
5. Every local scope is one continuous [min, max] window. Split discontiguous targets into independent tasks covering one row or consecutive adjacent rows. Check preview envelope_ms/warnings, submit, poll get_job_status, apply_alignment_result and fetch the new revision before previewing the next scope. Never perform same-model local recomputation or same-model original/vocal retries.
6. Reinspect get_timeline_visual against its numbered units mapping, get_acoustics and get_audio_excerpt for listening when supported. Report repaired rows and unresolved issues; stop repeated refinement on the same model.`}}]}));
}
