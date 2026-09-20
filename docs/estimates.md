# Estimates and accounting

This page explains how to make a routing estimate without turning it into a benchmark claim.

## Worked example

Assumptions:

- 8 inference rounds.
- 3 cheap rounds at 3,000 input + 1,000 output tokens each.
- 4 mid rounds at 5,000 input + 2,000 output tokens each.
- 1 strong round at 8,000 input + 3,000 output tokens.
- Rates copied from the checked-in configuration on 2026-09-18: cheap $0.06/$0.12, mid $0.20/$1.20,
  strong $2/$10 per million input/output tokens.
- Cache reads, retries, minimum billing, latency, and judge output are excluded.

| Route | Input tokens | Output tokens | Estimated cost |
| --- | ---: | ---: | ---: |
| Adaptive mix | 37,000 | 14,000 | $0.0605 |
| All strong | 37,000 | 14,000 | $0.2140 |
| All mid | 37,000 | 14,000 | $0.0242 |

Formula:

~~~text
cost = input_tokens / 1,000,000 × input_rate
     + output_tokens / 1,000,000 × output_rate
~~~

For the adaptive mix:

~~~text
3 × (3,000 × .06 + 1,000 × .12) / 1,000,000 = $0.00090
4 × (5,000 × .20 + 2,000 × 1.20) / 1,000,000 = $0.01360
1 × (8,000 × 2.00 + 3,000 × 10.0) / 1,000,000 = $0.04600
total = $0.06050
~~~

Against all-strong:

~~~text
1 - 0.0605 / 0.2140 = 71.7% lower estimated model cost
~~~

The token count itself is unchanged at 51,000 in this simplified example. The estimate comes from
moving 40,000 tokens to cheap/mid tiers and leaving 11,000 tokens on strong. The strong-priced
token share falls from 100% to 21.6%; that is not a claim that 78.4% of tokens disappear.

## Include routing overhead

If Jev is enabled, add judge input/output and any failed/timeout attempts. With the checked-in
example's $0.042/M judge input rate, a 6,000-token judge input is:

~~~text
6,000 × .042 / 1,000,000 = $0.000252
~~~

Also count:

- extra latency for the judge;
- retries owned by the host or provider;
- failed upstream requests that were billed;
- cache-read/cache-write rates;
- media accounting (the host estimate charges an image as 1,500 tokens on the mod path);
- any human review or re-run needed to finish the task.

## How to measure real gains

Run the same fixed task set with:

1. all-strong;
2. all-mid;
3. Sabi policy;
4. Sabi policy with Jev, if you intend to ship it.

Report completed-task success first, then cost per completed task, p50/p95 latency, escalation
precision, router/judge overhead, and failure/retry counts. A lower raw token bill with more failed
tasks is not a gain. Keep model IDs, provider prices, plan, harness version, date, and task outcomes
in the report.

The repository's offline eval is a development signal, not a published quality benchmark.
