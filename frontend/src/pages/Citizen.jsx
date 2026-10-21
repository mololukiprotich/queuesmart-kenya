import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, BellRing, BellOff, BadgeCheck, MessageCircle, TimerReset, Navigation } from "lucide-react";
import { api, wsUrlForService } from "../api";
import { formatWait } from "../format";
import { pushSupported, enablePushForPhone } from "../push";
import { getCitizenSession, setCitizenSession, clearCitizenSession } from "../citizenSession";
import { getSavedDetails, saveDetails, clearSavedDetails } from "../citizenDetails";
import { geolocationSupported, requestLocation, bestTravelEstimateSeconds } from "../travel";
import QueueOverview from "../components/QueueOverview";

/**
 * Citizen flow: pick branch -> pick service -> get a ticket -> watch live
 * position. Once a ticket exists we open ONE WebSocket for its service and
 * re-fetch just that ticket's state on every `queue_update` signal, rather
 * than polling on a timer — the citizen's screen updates the moment staff
 * call the next number, with no wasted requests in between.
 */
export default function Citizen() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState(null); // QueueStateOut
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState("idle"); // idle | enabling | on | denied | unsupported
  const [thresholdsBusy, setThresholdsBusy] = useState(false);
  const [initialPosition, setInitialPosition] = useState(null);

  // "Time to head to the centre" — Phase 1 (see improvemnt.md 4.1):
  // client-side only, no backend round trip, location never leaves this
  // tab. travelState mirrors the push opt-in pattern for consistency.
  const [travelState, setTravelState] = useState("idle"); // idle | requesting | on | denied | unsupported
  const [travelSeconds, setTravelSeconds] = useState(null);
  const [travelSource, setTravelSource] = useState(null); // "traffic" | "estimate"
  const [headOutFired, setHeadOutFired] = useState(false);

  // WhatsApp OTP verification — optional, layered on top of the plain
  // phone-number flow below. "verified" once this phone has passed OTP
  // this session (either just now, or via a restored localStorage session).
  const [otpStep, setOtpStep] = useState("idle"); // idle | code_sent | verified
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpDebugCode, setOtpDebugCode] = useState(""); // dev-mode only, see backend otp.py
  const [otpBusy, setOtpBusy] = useState(false);

  const [detailsRemembered, setDetailsRemembered] = useState(false);

  const wsRef = useRef(null);

  // Remembered details from a prior visit (see citizenDetails.js) —
  // prefills everything so a returning citizen only has to pick a
  // service, not re-type their phone/name/ID/email each time. Lower
  // assurance than the OTP session below (no server round trip, nothing
  // re-verified) — purely a local convenience for what they already typed
  // and consented to once.
  useEffect(() => {
    const saved = getSavedDetails();
    if (!saved) return;
    if (saved.branchId) setBranchId(saved.branchId);
    if (saved.phone) setPhone(saved.phone);
    if (saved.fullName) setFullName(saved.fullName);
    if (saved.nationalId) setNationalId(saved.nationalId);
    if (saved.email) setEmail(saved.email);
    if (saved.consent) setConsent(true);
    setDetailsRemembered(true);
  }, []);

  function forgetSavedDetails() {
    clearSavedDetails();
    setDetailsRemembered(false);
    setFullName("");
    setNationalId("");
    setEmail("");
    setConsent(false);
  }

  // Restore a previously verified phone from localStorage — re-validated
  // against the backend (a token surviving locally doesn't mean the
  // server still honors it) rather than trusted blindly.
  useEffect(() => {
    const saved = getCitizenSession();
    if (!saved?.token) return;
    api.checkCitizenSession(saved.token)
      .then(({ phone: verifiedPhone }) => {
        setPhone(verifiedPhone);
        setOtpStep("verified");
      })
      .catch(() => clearCitizenSession());
  }, []);

  // Autofill name/email from a prior visit once the phone number looks
  // complete — best-effort, never blocks the form. national_id is never
  // returned by this lookup (see backend schemas.ProfileAutofillOut).
  useEffect(() => {
    if (phone.replace(/\D/g, "").length < 9) return;
    let cancelled = false;
    api.getProfileAutofill(phone).then((profile) => {
      if (cancelled) return;
      if (profile.full_name && !fullName) setFullName(profile.full_name);
      if (profile.email && !email) setEmail(profile.email);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  async function sendOtp() {
    setOtpError("");
    setOtpBusy(true);
    try {
      const result = await api.requestOtp(phone);
      setOtpStep("code_sent");
      setOtpDebugCode(result.debug_code || "");
    } catch (e) {
      setOtpError(e.message);
    } finally {
      setOtpBusy(false);
    }
  }

  async function confirmOtp(e) {
    e.preventDefault();
    setOtpError("");
    setOtpBusy(true);
    try {
      const result = await api.verifyOtp(phone, otpCode);
      setCitizenSession(result);
      setOtpStep("verified");
      setOtpCode("");
    } catch (e) {
      setOtpError(e.message);
    } finally {
      setOtpBusy(false);
    }
  }

  function changeNumber() {
    clearCitizenSession();
    setOtpStep("idle");
    setOtpCode("");
    setOtpDebugCode("");
  }

  useEffect(() => {
    api.listBranches().then(setBranches).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!branchId) return;
    api.listServices(branchId).then(setServices).catch((e) => setError(e.message));
  }, [branchId]);

  useEffect(() => {
    if (!state?.ticket?.id) return;

    const ws = new WebSocket(wsUrlForService(state.ticket.service_id));
    wsRef.current = ws;
    ws.onmessage = () => {
      api.getTicketState(state.ticket.id).then(setState).catch(() => {});
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ticket?.id]);

  // Baseline to measure progress-bar fill against — captured once per
  // ticket, the first time it's seen waiting, so the bar counts down from
  // wherever this citizen actually started rather than a fixed assumption.
  useEffect(() => {
    if (state?.ticket?.status === "waiting" && state.position > 0 && initialPosition === null) {
      setInitialPosition(state.position);
    }
    if (!state?.ticket?.id) {
      setInitialPosition(null);
      setHeadOutFired(false); // reset between tickets
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ticket?.id, state?.position]);

  // Fires once, client-side, the moment the live estimate drops to or
  // below the travel estimate — reuses the same refetch-on-queue_update
  // flow already driving the position/wait display above, no extra
  // polling. Only shows a local notification if push permission is
  // already granted (same permission Notification() needs); otherwise
  // the in-page banner below is the only signal, which is why this is
  // offered as a companion to, not a replacement for, the push opt-in.
  useEffect(() => {
    if (travelState !== "on" || headOutFired || !state?.ticket) return;
    if (state.ticket.status !== "waiting") return;
    if (state.estimated_wait_seconds > travelSeconds) return;

    setHeadOutFired(true);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Time to head to the centre", {
        body: `Ticket ${state.ticket.number} — your wait is about as long as your trip here.`,
        icon: "/favicon.svg",
      });
    }
  }, [state, travelState, travelSeconds, headOutFired]);

  async function handleEnablePush() {
    if (!pushSupported()) {
      setPushState("unsupported");
      return;
    }
    setPushState("enabling");
    const ok = await enablePushForPhone(state.ticket.phone);
    setPushState(ok ? "on" : "denied");
  }

  async function handleShareLocation(branch) {
    if (!geolocationSupported()) {
      setTravelState("unsupported");
      return;
    }
    setTravelState("requesting");
    const loc = await requestLocation();
    if (!loc) {
      setTravelState("denied");
      return;
    }
    const { seconds, source } = await bestTravelEstimateSeconds(loc.lat, loc.lon, branch.latitude, branch.longitude);
    setTravelSeconds(seconds);
    setTravelSource(source);
    setTravelState("on");
  }

  async function toggleThreshold(seconds) {
    const current = state.ticket.notify_thresholds || [];
    const next = current.includes(seconds)
      ? current.filter((t) => t !== seconds)
      : [...current, seconds];
    setThresholdsBusy(true);
    try {
      const updatedTicket = await api.setNotifyThresholds(state.ticket.id, next);
      setState((prev) => ({ ...prev, ticket: updatedTicket }));
    } catch (e) {
      setError(e.message);
    } finally {
      setThresholdsBusy(false);
    }
  }

  async function joinQueue(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await api.createTicket(serviceId, phone, {
        full_name: fullName || undefined,
        national_id: nationalId || undefined,
        email: email || undefined,
        consent_given: consent,
      });
      setState(result);
      // Remember for next visit — phone/branch always (needed for the
      // "just pick a service" flow), the rest only if consent was given,
      // mirroring what's allowed to be saved server-side.
      saveDetails({
        branchId,
        phone,
        fullName: consent ? fullName : "",
        nationalId: consent ? nationalId : "",
        email: consent ? email : "",
        consent,
      });
    } catch (e) {
      setError(e.message);
    }
  }

  if (state) {
    const { ticket, position, estimated_wait_seconds, service_name, visit_steps } = state;
    const called = ticket.status !== "waiting";
    const isMultiVisit = visit_steps.length > 1;
    const progress = initialPosition ? Math.min(1, 1 - (position - 1) / initialPosition) : 0;
    const currentBranch = branches.find((b) => b.id === branchId);
    const hasBranchLocation = currentBranch?.latitude != null && currentBranch?.longitude != null;
    return (
      <div className="panel">
        <span className="eyebrow">{service_name}</span>
        <div className={`ticket-number-wrap ${!called ? "ticket-pulse" : ""}`}>
          <div className="ticket-number">{ticket.number}</div>
        </div>
        {!called && initialPosition > 1 && (
          <div className="progress-track" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        {isMultiVisit && (
          <div className="stepper" aria-label="Visit progress">
            {visit_steps.map((step, i) => {
              const stepState = i < ticket.step_index ? "done" : i === ticket.step_index ? "current" : "upcoming";
              return (
                <div className="stepper-item" key={step} data-state={stepState}>
                  <span className="stepper-dot">{stepState === "done" ? "✓" : i + 1}</span>
                  <span className="stepper-label">{step}</span>
                </div>
              );
            })}
          </div>
        )}

        {called ? (
          <p className="status-called">It's your turn — please proceed to the counter.</p>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-label">Position</div>
                <div className="stat-value">{position}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Estimated wait</div>
                <div className="stat-value">{formatWait(estimated_wait_seconds)}</div>
              </div>
            </div>
            <p className="hint">This page updates live — no need to refresh. You can close it and come back.</p>

            {pushState !== "on" && pushState !== "unsupported" && (
              <button
                type="button"
                className="secondary push-cta"
                onClick={handleEnablePush}
                disabled={pushState === "enabling"}
              >
                <BellRing size={15} strokeWidth={2.25} aria-hidden="true" />
                {pushState === "enabling" ? "Enabling…" : "Notify me when it's my turn"}
              </button>
            )}
            {pushState === "on" && (
              <p className="hint push-on"><BellRing size={14} strokeWidth={2.25} aria-hidden="true" /> Notifications on — you can close this page.</p>
            )}
            {pushState === "denied" && (
              <p className="hint push-off"><BellOff size={14} strokeWidth={2.25} aria-hidden="true" /> Notifications blocked — enable them in your browser settings to use this.</p>
            )}

            {pushState === "on" && estimated_wait_seconds > 600 && (
              <div className="threshold-box">
                <p className="hint threshold-hint">
                  <TimerReset size={14} strokeWidth={2.25} aria-hidden="true" />
                  Also notify me when the wait drops to:
                </p>
                <div className="threshold-options">
                  {[
                    { label: "20 min", seconds: 1200 },
                    { label: "10 min", seconds: 600 },
                  ].map((opt) => {
                    const active = (ticket.notify_thresholds || []).includes(opt.seconds);
                    return (
                      <button
                        key={opt.seconds}
                        type="button"
                        className={`threshold-chip ${active ? "threshold-chip-active" : ""}`}
                        onClick={() => toggleThreshold(opt.seconds)}
                        disabled={thresholdsBusy}
                        aria-pressed={active}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {headOutFired && (
              <div className="head-out-banner">
                <Navigation size={15} strokeWidth={2.25} aria-hidden="true" />
                Time to head to the centre — your wait is about as long as your trip here.
              </div>
            )}

            {hasBranchLocation && travelState === "idle" && (
              <button type="button" className="secondary travel-cta" onClick={() => handleShareLocation(currentBranch)}>
                <Navigation size={15} strokeWidth={2.25} aria-hidden="true" />
                Tell me when to leave
              </button>
            )}
            {travelState === "requesting" && <p className="hint">Getting your location…</p>}
            {travelState === "on" && !headOutFired && (
              <p className="hint">
                <Navigation size={14} strokeWidth={2.25} aria-hidden="true" />
                About {formatWait(travelSeconds)} away{travelSource === "traffic" ? " (live traffic)" : ""} — we'll flag it here when it's time to leave.
              </p>
            )}
            {travelState === "denied" && (
              <p className="hint push-off">Location unavailable — enable it in your browser settings to use this.</p>
            )}
          </>
        )}

        <div className="panel-footer">
          <Link to="/history" state={{ phone: ticket.phone }}>View my history</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <span className="eyebrow">Join a queue</span>
      {detailsRemembered && (
        <div className="remembered-banner">
          <BadgeCheck size={14} strokeWidth={2.25} aria-hidden="true" />
          <span>Welcome back — your details are filled in. Just pick a service.</span>
          <button type="button" className="otp-link" onClick={forgetSavedDetails}>Not you?</button>
        </div>
      )}
      {branchId && <QueueOverview branchId={branchId} />}
      <form onSubmit={joinQueue} className="form">
        <label>
          Branch
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
            <option value="" disabled>Select a branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required disabled={!branchId}>
            <option value="" disabled>Select a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Phone number
          <input
            type="tel"
            placeholder="+2547..."
            value={phone}
            onChange={(e) => { setPhone(e.target.value); if (otpStep !== "idle") setOtpStep("idle"); }}
            disabled={otpStep === "verified"}
            required
          />
        </label>

        {otpStep === "verified" ? (
          <div className="otp-verified">
            <BadgeCheck size={16} strokeWidth={2.25} aria-hidden="true" />
            <span>Phone verified via WhatsApp</span>
            <button type="button" className="otp-link" onClick={changeNumber}>Not you?</button>
          </div>
        ) : otpStep === "code_sent" ? (
          <div className="otp-box">
            <label>
              Enter the 6-digit code sent on WhatsApp
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            {otpDebugCode && (
              <p className="hint">Dev mode (no WhatsApp configured) — code is <strong>{otpDebugCode}</strong></p>
            )}
            <div className="otp-actions">
              <button type="button" onClick={confirmOtp} disabled={otpBusy || otpCode.length !== 6}>
                {otpBusy ? "Verifying…" : "Verify code"}
              </button>
              <button type="button" className="otp-link" onClick={sendOtp} disabled={otpBusy}>Resend code</button>
            </div>
            {otpError && <p className="error">{otpError}</p>}
          </div>
        ) : (
          <button
            type="button"
            className="secondary otp-cta"
            onClick={sendOtp}
            disabled={otpBusy || phone.replace(/\D/g, "").length < 9}
          >
            <MessageCircle size={15} strokeWidth={2.25} aria-hidden="true" />
            {otpBusy ? "Sending…" : "Verify via WhatsApp (optional)"}
          </button>
        )}
        {otpStep !== "code_sent" && otpError && <p className="error">{otpError}</p>}

        <div className="privacy-note">
          <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
          <span>
            The details below are optional and only used to speed up your visit.
            Your ID number is never shown to counter staff — only branch admins
            can access it, and only when required.
          </span>
        </div>

        <label>
          Full name <span className="optional">(optional)</span>
          <input
            type="text"
            placeholder="As on your ID"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </label>
        <label>
          National ID number <span className="optional">(optional)</span>
          <input
            type="text"
            placeholder="e.g. 12345678"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
          />
        </label>
        <label>
          Email <span className="optional">(optional)</span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={!(fullName || nationalId || email)}
          />
          <span>I consent to QueueSmart Kenya storing these details for future visits.</span>
        </label>

        <button type="submit">Get my ticket</button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="panel-footer">
        <Link to="/history">View my history</Link>
      </div>
    </div>
  );
}
