declare global { interface Window { studioSpectrumDiagnostics?: boolean } }
/** Set before mounting the spectrum for an explicit measurement session. */
export const spectrumDiagnosticsEnabled = () => window.studioSpectrumDiagnostics === true;
