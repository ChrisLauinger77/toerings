// Used only by Linux bundle smoke tests via LD_PRELOAD. Fail deterministically
// when an X display opens before successful Xlib thread initialization.
#define _GNU_SOURCE
#include <X11/Xlib.h>
#include <dlfcn.h>
#include <limits.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static atomic_int threads_initialized;
static atomic_int display_checked;

static void *required_symbol(const char *name) {
    void *symbol = dlsym(RTLD_NEXT, name);
    if (symbol == NULL) {
        fprintf(stderr, "ToeRings X11 guard: cannot resolve %s\n", name);
        _Exit(86);
    }
    return symbol;
}

int XInitThreads(void) {
    int (*initialize)(void) = required_symbol("XInitThreads");
    int status = initialize();
    if (status != 0) {
        atomic_store(&threads_initialized, 1);
    }
    return status;
}

Display *XOpenDisplay(const char *name) {
    Display *(*open_display)(const char *) = required_symbol("XOpenDisplay");
    char executable[PATH_MAX];
    ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (length < 0 || length == sizeof(executable) - 1) {
        fputs("ToeRings X11 guard: cannot identify executable\n", stderr);
        _Exit(86);
    }
    executable[length] = '\0';
    const char *basename = strrchr(executable, '/');
    // WebKit subprocesses inherit LD_PRELOAD but have their own Xlib lifecycle.
    if (basename == NULL || strcmp(basename + 1, "ToeRings") != 0) {
        return open_display(name);
    }
    if (!atomic_load(&threads_initialized)) {
        fputs("ToeRings X11 guard: XOpenDisplay called before XInitThreads\n", stderr);
        _Exit(86);
    }
    if (!atomic_exchange(&display_checked, 1)) {
        fputs("ToeRings X11 startup ordering verified\n", stderr);
    }
    return open_display(name);
}
