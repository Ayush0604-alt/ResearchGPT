# Evaluating prompt changes

Every review stores how it was made (`literature_reviews.run_meta`): the prompt
version, provider, models, token usage per model, duration, and how many
invented citations were removed. `backend/scripts/eval_reviews.py` turns the
stored reviews into metrics and averages them per prompt version, so you can
tell whether a prompt change made results better or worse.

## Procedure

1. **Baseline.** With the current prompts, create one project per topic in
   [`topics.json`](topics.json) (the topic text must match exactly, case aside)
   and run each one. Use the same models and the same *Papers per project* for
   every run.
2. **Change the prompts** in `frontend/src/research/` (`prompts.ts`,
   `screening.ts`, `verify.ts`) and bump `PROMPT_VERSION` in `prompts.ts`.
3. **Run the same topics again** as new projects.
4. **Compare:**

   ```bash
   cd backend
   python scripts/eval_reviews.py             # averages per prompt version
   python scripts/eval_reviews.py --by-topic  # one row per review
   python scripts/eval_reviews.py --json      # for further analysis
   ```

   The script only reads. It uses `DATABASE_URL` from `backend/.env` or the
   environment.

## Metrics

| Column | Meaning | Better |
|---|---|---|
| sections | non-empty review sections, out of 7 | higher |
| words | words in the prose sections | context |
| cited | share of prose sentences that cite a paper | higher |
| coverage | share of analysed papers the review cites | higher |
| supported | share of checked claims the cited papers support | higher |
| unsupported | share of checked claims the cited papers don't support | lower |
| invented | citations to papers that don't exist, removed before saving | lower |
| tokens | input + output tokens for the whole run | lower |

`supported` and `unsupported` come from the automatic citation check, which
uses the fast model and is itself imperfect. Treat a change of a few points
on 8 topics as noise. Before adopting a prompt, read a couple of reviews from
each version side by side.

## Why not an automated judge?

A second model grading the reviews would cost every run more tokens on the
user's key, and a model's judgement of prose quality drifts with the model.
The metrics above cost nothing extra, because they come from data each run
already produces, and they measure what matters most for a literature review:
citations that are real and supported, and coverage of the papers found.
