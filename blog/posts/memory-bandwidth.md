---
title: Why Memory Bandwidth is Often the Bottleneck
date: 2026-01-21
---

# Why Memory Bandwidth is Often the Bottleneck

When I first started learning about GPU programming, I assumed that "more compute = faster." More CUDA cores, more tensor cores, more floating point operations per second. But the reality is more nuanced — and understanding why has changed how I think about ML performance.

-----

## The Intuition

Imagine a factory with incredibly fast assembly lines (the compute units), but a single narrow door for bringing in raw materials (memory bandwidth). It doesn't matter how fast your assembly lines are if they're sitting idle waiting for materials.

This is exactly what happens in many neural network operations.

## The Numbers

Let's look at an NVIDIA A100:

- **Compute**: 19.5 TFLOPS (FP32) — can do 19.5 trillion floating point operations per second
- **Memory Bandwidth**: 2 TB/s — can move 2 trillion bytes per second

Now consider a simple operation: adding two vectors of 1 billion float32 numbers.

```
Data to load:  2 × 1B × 4 bytes = 8 GB
Data to write: 1 × 1B × 4 bytes = 4 GB
Total memory:  12 GB

Time at 2 TB/s: 12 GB / 2000 GB/s = 6 ms
```

The actual compute? 1 billion additions. At 19.5 TFLOPS, that's:

```
1B ops / 19.5T ops/sec = 0.05 ms
```

The compute takes 0.05 ms. The memory transfer takes 6 ms. The operation is **120x memory-bound**.

## Arithmetic Intensity

This ratio — compute operations per byte of memory accessed — is called **arithmetic intensity**. It's the key metric for understanding whether your workload is compute-bound or memory-bound.

```
Arithmetic Intensity = FLOPs / Bytes Accessed
```

- **Low intensity** (< 10): Memory-bound. Most elementwise ops, attention in transformers.
- **High intensity** (> 100): Compute-bound. Large matrix multiplications.

## Why This Matters for ML

Many operations in neural networks have low arithmetic intensity:

- **Activation functions** (ReLU, GELU): Load, compute one op, store. Intensity ≈ 0.25
- **Normalization** (LayerNorm, BatchNorm): Multiple passes over data
- **Attention**: The softmax and score computation are memory-heavy
- **Small batch sizes**: Less data reuse, more memory pressure

Only large matrix multiplications (like the weight multiplies in linear layers) have high enough intensity to fully utilize the GPU's compute.

## What Can You Do?

Understanding this changes how you optimize:

1. **Fuse operations**: Combine multiple low-intensity ops into one kernel, so data stays in fast cache
2. **Increase batch size**: More data reuse per memory load
3. **Use lower precision**: FP16/BF16 cuts memory bandwidth needs in half
4. **Operator fusion frameworks**: Tools like torch.compile, XLA, and Triton can fuse automatically

## The Deeper Rabbit Hole

This is just the surface. The memory hierarchy goes deeper:

- **Registers**: Fastest, but tiny (hundreds of KB per SM)
- **Shared memory**: Fast, programmer-controlled (up to 228 KB per SM on A100)
- **L2 cache**: Larger but slower (40 MB on A100)
- **HBM (main memory)**: Huge but "slow" (80 GB on A100)

Understanding which operations hit which level of the hierarchy is where real optimization happens.

## Questions I'm Still Exploring

- How do different attention implementations (FlashAttention, PagedAttention) improve memory efficiency?
- What makes certain batch sizes "optimal" for a given GPU?
- How does quantization (INT8, INT4) change the memory/compute balance?

-----

*This is the start of my exploration into ML engineering. More questions than answers for now.*
