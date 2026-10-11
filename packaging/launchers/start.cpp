// A console executable, not a batch host: Ctrl+C is handled by Python.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <cstdio>
#include <string>

static BOOL WINAPI console_event(DWORD event) {
    return event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT;
}

static std::wstring quote(const std::wstring& value) {
    std::wstring out = L"\"";
    size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { ++slashes; continue; }
        out.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        out += c;
        slashes = 0;
    }
    out.append(slashes * 2, L'\\');
    return out + L"\"";
}

int wmain(int argc, wchar_t** argv) {
    wchar_t path[32768];
    DWORD length = GetModuleFileNameW(nullptr, path, 32768);
    if (!length || length >= 32768) return 1;
    std::wstring root(path, length);
    root.resize(root.find_last_of(L"\\/"));
    std::wstring python = root + L"\\runtime\\python\\python.exe";
    std::wstring command = quote(python) + L" -E -s -X utf8 -m server.portable --root " + quote(root);
    for (int i = 1; i < argc; ++i) command += L" " + quote(argv[i]);
    if (command.size() >= 32767) return 1;

    // Selection in legacy conhost must not suspend the server; keep Ctrl+C enabled.
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    DWORD old_mode = 0;
    BOOL console_input = GetConsoleMode(input, &old_mode);
    if (console_input)
        SetConsoleMode(input, (old_mode | ENABLE_EXTENDED_FLAGS | ENABLE_PROCESSED_INPUT) & ~ENABLE_QUICK_EDIT_MODE);
    SetConsoleCtrlHandler(nullptr, FALSE);
    SetConsoleCtrlHandler(console_event, TRUE);

    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    BOOL job_ready = job && SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = input;
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};
    DWORD result = 1;
    if (job_ready && CreateProcessW(python.c_str(), command.data(), nullptr, nullptr, TRUE,
                                   CREATE_SUSPENDED, nullptr, (root + L"\\app").c_str(), &startup, &process)) {
        if (AssignProcessToJobObject(job, process.hProcess) && ResumeThread(process.hThread) != (DWORD)-1) {
            WaitForSingleObject(process.hProcess, INFINITE);
            GetExitCodeProcess(process.hProcess, &result);
        } else {
            std::fprintf(stderr, "Cannot supervise Studio (Windows error %lu).\n", GetLastError());
            TerminateProcess(process.hProcess, 1);
            WaitForSingleObject(process.hProcess, INFINITE);
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    } else {
        std::fprintf(stderr, "Cannot start Studio (Windows error %lu). Restore the complete package.\n", GetLastError());
    }
    if (job) CloseHandle(job);
    if (console_input) SetConsoleMode(input, old_mode);
    SetConsoleCtrlHandler(console_event, FALSE);
    DWORD processes[2];
    if (result && GetConsoleProcessList(processes, 2) == 1) {
        std::fprintf(stderr, "Studio failed to start. Press Enter to close.\n");
        std::getchar();
    }
    return static_cast<int>(result);
}
