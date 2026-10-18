// Routes large ggml allocations to PS5 direct memory.
//
// ggml's CPU backend (ggml_backend_cpu_buffer, the SheetSage weight stores and
// graph pools) allocates through posix_memalign/aligned_alloc, which land in
// the app's flexible-memory heap — only a few hundred MiB, while the model
// wants gigabytes. The GPU's direct-memory pool (11+ GiB, what radv already
// uses) is the right home. --wrap at link time catches every libc import call,
// including the ones from inside ggml.a. Small allocations are untouched; if
// the kernel refuses a direct allocation we fall back to the heap and fail the
// same way as before, so a wrong constant can never crash silently.
//
// A direct block is [2 MiB header region][payload]; the pad keeps the payload
// 2 MiB-aligned. free() recognises direct payloads by pointer identity in a
// small side table — nothing is ever dereferenced below an arbitrary heap
// pointer, which would be unmapped memory for small blocks.

#include <cstddef>
#include <cstdint>

namespace
{
constexpr std::uint64_t kDirectMin = 8u << 20; // route allocations >= 8 MiB
constexpr std::uint64_t kHeaderPad = 2u << 20; // header region, also alignment pad
constexpr std::uint64_t kPageSize = 2u << 20;  // kernel granularity for large allocations

struct Live
{
    void *payload;
    void *base;
    std::int64_t physical;
    std::uint64_t mapped;
};

// Engine loads are sequential and none keeps more than a handful of
// multi-megabyte buffers alive; the table is only scanned on free().
Live g_live[64];

void table_add(void *payload, void *base, std::int64_t physical, std::uint64_t mapped)
{
    for (auto &slot : g_live)
        if (!slot.payload)
        {
            slot = {payload, base, physical, mapped};
            return;
        }
    // Table full (unexpected): leak the mapping rather than lose track of it.
}

bool table_take(void *payload, Live &out)
{
    for (auto &slot : g_live)
        if (slot.payload == payload)
        {
            out = slot;
            slot = {};
            return true;
        }
    return false;
}
}

extern "C"
{
// PS5 kernel direct-memory API, as used by the radv PS5 winsys (type 12,
// CPU+GPU read/write protection).
int sceKernelGetDirectMemorySize();
int sceKernelAllocateDirectMemory(std::int64_t search_start, std::int64_t search_end,
                                  std::uint64_t size, std::uint64_t alignment, int type,
                                  std::int64_t *physical);
int sceKernelMapDirectMemory(void **addr, std::uint64_t size, int prot, int flags,
                             std::int64_t physical, std::uint64_t alignment);
int sceKernelMunmap(void *addr, std::uint64_t size);
int sceKernelReleaseDirectMemory(std::int64_t physical, std::uint64_t size);

int __real_posix_memalign(void **memptr, std::size_t alignment, std::size_t size);
void *__real_aligned_alloc(std::size_t alignment, std::size_t size);
void __real_free(void *ptr);

void *direct_alloc(std::size_t size)
{
    const std::uint64_t mapped = (size + kHeaderPad + kPageSize - 1) & ~(kPageSize - 1);
    std::int64_t physical = -1;
    if (sceKernelAllocateDirectMemory(0, sceKernelGetDirectMemorySize(), mapped, kPageSize, 12,
                                      &physical) != 0)
        return nullptr;
    void *base = nullptr;
    // prot: CPU read|write (0x03) + GPU read|write (0x30); flags 0 places it freely.
    if (sceKernelMapDirectMemory(&base, mapped, 0x33, 0, physical, kPageSize) != 0 || !base)
    {
        sceKernelReleaseDirectMemory(physical, mapped);
        return nullptr;
    }
    void *payload = static_cast<char *>(base) + kHeaderPad;
    table_add(payload, base, physical, mapped);
    return payload;
}

int __wrap_posix_memalign(void **memptr, std::size_t alignment, std::size_t size)
{
    if (memptr && size >= kDirectMin && alignment <= kHeaderPad)
    {
        void *direct = direct_alloc(size);
        if (direct)
        {
            *memptr = direct;
            return 0;
        }
        // Fall through: heap, then the caller's own out-of-memory path.
    }
    return __real_posix_memalign(memptr, alignment, size);
}

void *__wrap_aligned_alloc(std::size_t alignment, std::size_t size)
{
    if (size >= kDirectMin && alignment <= kHeaderPad)
    {
        void *direct = direct_alloc(size);
        if (direct)
            return direct;
    }
    return __real_aligned_alloc(alignment, size);
}

void __wrap_free(void *ptr)
{
    Live block;
    if (ptr && table_take(ptr, block))
    {
        sceKernelMunmap(block.base, block.mapped);
        sceKernelReleaseDirectMemory(block.physical, block.mapped);
        return;
    }
    __real_free(ptr);
}
}
