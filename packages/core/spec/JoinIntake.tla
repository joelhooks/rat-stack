---- MODULE JoinIntake ----
EXTENDS Naturals

CONSTANTS MaxCrashes, MaxRetries, MaxOutages, EraseDuringRequest, IndexAfterRecord,
          SetStateReadsThenWrites, MarkBeforeSave, EraseSticky

Writers == {"request", "background", "sweep", "eraser"}
Deliverers == {"background", "sweep"}
Sub == "submission"
KeyFor(d) == Sub

Records == {"absent", "held", "ready", "accepted", "refused"}
Marks == {"none", "delivery", "erase"}
Results == {"accepted", "refused", "retry"}
Seen == [rec : Records, pend : Marks]

VARIABLES
  rec, pend, indexed, erasedKey, events, basinUp,
  req, reqSeen, answered,
  dpc, dseen, sawErase, result, keys, sentAfterErase,
  epc, eseen, marked, tombstoned, removed,
  idx, crashes, retries, outages

vars == << rec, pend, indexed, erasedKey, events, basinUp,
           req, reqSeen, answered,
           dpc, dseen, sawErase, result, keys, sentAfterErase,
           epc, eseen, marked, tombstoned, removed,
           idx, crashes, retries, outages >>

TypeOK ==
  /\ rec \in Records
  /\ pend \in Marks
  /\ indexed \in BOOLEAN
  /\ erasedKey \in BOOLEAN
  /\ events \in {"none", "recorded", "tombstoned"}
  /\ basinUp \in BOOLEAN
  /\ req \in {"start", "held", "recorded", "read", "committing", "answered", "dead"}
  /\ reqSeen \in Seen
  /\ answered \in BOOLEAN
  /\ dpc \in [Deliverers -> {"idle", "queued", "sending", "settleRead", "settling", "flushing"}]
  /\ dseen \in [Deliverers -> Seen]
  /\ sawErase \in [Deliverers -> BOOLEAN]
  /\ result \in [Deliverers -> Results]
  /\ keys \subseteq ({Sub} \cup Deliverers)
  /\ sentAfterErase \in BOOLEAN
  /\ epc \in {"idle", "marking", "flushing", "tombstoning", "parked", "removing", "clearing", "done"}
  /\ eseen \in Seen
  /\ marked \in BOOLEAN
  /\ tombstoned \in BOOLEAN
  /\ removed \in BOOLEAN
  /\ idx \in [Writers -> {"none", "armed", "mark", "clear"}]
  /\ crashes \in 0..MaxCrashes
  /\ retries \in 0..MaxRetries
  /\ outages \in 0..MaxOutages

Owed == rec # "absent" /\ pend # "none"

AnswerAtCommit == answered => (removed \/ rec \in {"ready", "accepted", "refused"})

SameKey == keys \subseteq {Sub}

NoSendAfterErase == ~sentAfterErase

TombstoneBeforeRemove == removed => tombstoned

EraseWins == marked => (rec = "absent" \/ pend = "erase")

OwedIsFindable == Owed => indexed

Settles == Owed ~> ~Owed

Flushed(w) == idx[w] = "none"

Armed(w, p) == IndexAfterRecord /\ MarkBeforeSave /\ p # "none"

Refused(p) == erasedKey \/ (EraseSticky /\ pend = "erase" /\ p # "erase")

Save(w, r, p) ==
  /\ Armed(w, p) => idx[w] = "armed"
  /\ IF Refused(p)
       THEN /\ idx' = [idx EXCEPT ![w] = "none"]
            /\ UNCHANGED << rec, pend, indexed >>
       ELSE /\ rec' = r
            /\ pend' = p
            /\ IF IndexAfterRecord
                 THEN /\ idx' = [idx EXCEPT ![w] = CASE Armed(w, p) -> "none"
                                                      [] p = "none" -> "clear"
                                                      [] OTHER -> "mark"]
                      /\ UNCHANGED indexed
                 ELSE /\ indexed' = (p # "none")
                      /\ UNCHANGED idx

AtSave(w) ==
  CASE w = "request" -> req = "read"
    [] w = "eraser" -> epc = "marking"
    [] OTHER -> dpc[w] = "settling"

PreMark(w) ==
  /\ IndexAfterRecord /\ MarkBeforeSave
  /\ idx[w] = "none"
  /\ AtSave(w)
  /\ indexed' = TRUE
  /\ idx' = [idx EXCEPT ![w] = "armed"]
  /\ UNCHANGED << rec, pend, erasedKey, events, basinUp, req, reqSeen, answered,
                  dpc, dseen, sawErase, result, keys, sentAfterErase,
                  epc, eseen, marked, tombstoned, removed, crashes, retries, outages >>

KeepMark(p, state) ==
  IF p = "erase" THEN "erase"
  ELSE IF p = "delivery" /\ state = "ready" THEN "delivery"
  ELSE "none"

StateFor(r) == IF r = "retry" THEN "ready" ELSE r

FlushIndex(w) ==
  /\ idx[w] \in {"mark", "clear"}
  /\ indexed' = (idx[w] = "mark")
  /\ idx' = [idx EXCEPT ![w] = "none"]
  /\ UNCHANGED << rec, pend, erasedKey, events, basinUp, req, reqSeen, answered,
                  dpc, dseen, sawErase, result, keys, sentAfterErase,
                  epc, eseen, marked, tombstoned, removed, crashes, retries, outages >>

SaveHeld ==
  /\ req = "start"
  /\ Save("request", "held", "none")
  /\ req' = "held"
  /\ UNCHANGED << erasedKey, events, basinUp, reqSeen, answered, dpc, dseen, sawErase,
                  result, keys, sentAfterErase, epc, eseen, marked, tombstoned, removed,
                  crashes, retries, outages >>

RecordEvents ==
  /\ req = "held"
  /\ idx["request"] = "none"
  /\ events' = IF events = "none" THEN "recorded" ELSE events
  /\ req' = "recorded"
  /\ UNCHANGED << rec, pend, indexed, erasedKey, basinUp, reqSeen, answered, dpc, dseen,
                  sawErase, result, keys, sentAfterErase, epc, eseen, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

CommitRead ==
  /\ req = "recorded"
  /\ reqSeen' = [rec |-> rec, pend |-> pend]
  /\ req' = IF rec = "absent" THEN "answered" ELSE "read"
  /\ answered' = (rec = "absent")
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, dpc, dseen, sawErase,
                  result, keys, sentAfterErase, epc, eseen, marked, tombstoned, removed,
                  idx, crashes, retries, outages >>

CommitWrite ==
  /\ req = "read"
  /\ Save("request", "ready", IF reqSeen.pend = "erase" THEN "erase" ELSE "delivery")
  /\ req' = "committing"
  /\ UNCHANGED << erasedKey, events, basinUp, reqSeen, answered, dpc, dseen, sawErase,
                  result, keys, sentAfterErase, epc, eseen, marked, tombstoned, removed,
                  crashes, retries, outages >>

Answer ==
  /\ req = "committing"
  /\ idx["request"] = "none"
  /\ answered' = TRUE
  /\ req' = "answered"
  /\ dpc' = [dpc EXCEPT !["background"] = "queued"]
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, reqSeen, dseen,
                  sawErase, result, keys, sentAfterErase, epc, eseen, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

SweepVisit ==
  /\ dpc["sweep"] = "idle"
  /\ idx["sweep"] = "none"
  /\ indexed
  /\ \/ /\ pend = "erase"
        /\ epc = "parked"
        /\ epc' = "tombstoning"
        /\ UNCHANGED << dpc, indexed >>
     \/ /\ pend = "delivery"
        /\ rec = "ready"
        /\ dpc' = [dpc EXCEPT !["sweep"] = "queued"]
        /\ UNCHANGED << epc, indexed >>
     \/ /\ pend = "none"
        /\ indexed' = FALSE
        /\ UNCHANGED << dpc, epc >>
  /\ UNCHANGED << rec, pend, erasedKey, events, basinUp, req, reqSeen, answered, dseen,
                  sawErase, result, keys, sentAfterErase, eseen, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

DeliveryRead(d) ==
  /\ dpc[d] = "queued"
  /\ sawErase' = [sawErase EXCEPT ![d] = (pend = "erase")]
  /\ IF rec \in {"absent", "held"} \/ pend = "erase"
       THEN /\ dpc' = [dpc EXCEPT ![d] = "settleRead"]
            /\ result' = [result EXCEPT ![d] = "refused"]
       ELSE /\ dpc' = [dpc EXCEPT ![d] = "sending"]
            /\ UNCHANGED result
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dseen, keys, sentAfterErase, epc, eseen, marked, tombstoned, removed,
                  idx, crashes, retries, outages >>

DeliverySend(d) ==
  /\ dpc[d] = "sending"
  /\ keys' = keys \cup {KeyFor(d)}
  /\ sentAfterErase' = (sentAfterErase \/ sawErase[d])
  /\ \E r \in Results :
       /\ (r = "retry") => (retries < MaxRetries)
       /\ result' = [result EXCEPT ![d] = r]
       /\ retries' = IF r = "retry" THEN retries + 1 ELSE retries
  /\ dpc' = [dpc EXCEPT ![d] = "settleRead"]
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dseen, sawErase, epc, eseen, marked, tombstoned, removed, idx,
                  crashes, outages >>

SettleRead(d) ==
  /\ dpc[d] = "settleRead"
  /\ dseen' = [dseen EXCEPT ![d] = [rec |-> rec, pend |-> pend]]
  /\ dpc' = [dpc EXCEPT ![d] = "settling"]
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  sawErase, result, keys, sentAfterErase, epc, eseen, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

SettleWrite(d) ==
  /\ dpc[d] = "settling"
  /\ LET seen == IF SetStateReadsThenWrites THEN dseen[d] ELSE [rec |-> rec, pend |-> pend]
         state == StateFor(result[d])
     IN IF seen.rec = "absent"
          THEN UNCHANGED << rec, pend, indexed, idx >>
          ELSE Save(d, state, KeepMark(seen.pend, state))
  /\ dpc' = [dpc EXCEPT ![d] = "flushing"]
  /\ UNCHANGED << erasedKey, events, basinUp, req, reqSeen, answered, dseen, sawErase,
                  result, keys, sentAfterErase, epc, eseen, marked, tombstoned, removed,
                  crashes, retries, outages >>

DeliveryDone(d) ==
  /\ dpc[d] = "flushing"
  /\ idx[d] = "none"
  /\ dpc' = [dpc EXCEPT ![d] = "idle"]
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dseen, sawErase, result, keys, sentAfterErase, epc, eseen, marked,
                  tombstoned, removed, idx, crashes, retries, outages >>

EraseRead ==
  /\ epc = "idle"
  /\ EraseDuringRequest \/ req \in {"answered", "dead"}
  /\ rec # "absent"
  /\ eseen' = [rec |-> rec, pend |-> pend]
  /\ epc' = IF pend = "erase" THEN "tombstoning" ELSE "marking"
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dpc, dseen, sawErase, result, keys, sentAfterErase, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

EraseMark ==
  /\ epc = "marking"
  /\ Save("eraser", eseen.rec, "erase")
  /\ marked' = TRUE
  /\ epc' = "flushing"
  /\ UNCHANGED << erasedKey, events, basinUp, req, reqSeen, answered, dpc, dseen, sawErase,
                  result, keys, sentAfterErase, eseen, tombstoned, removed,
                  crashes, retries, outages >>

EraseMarked ==
  /\ epc = "flushing"
  /\ idx["eraser"] = "none"
  /\ epc' = "tombstoning"
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dpc, dseen, sawErase, result, keys, sentAfterErase, eseen, marked,
                  tombstoned, removed, idx, crashes, retries, outages >>

Tombstone ==
  /\ epc = "tombstoning"
  /\ IF basinUp
       THEN /\ events' = "tombstoned"
            /\ tombstoned' = TRUE
            /\ epc' = "removing"
       ELSE /\ epc' = "parked"
            /\ UNCHANGED << events, tombstoned >>
  /\ UNCHANGED << rec, pend, indexed, erasedKey, basinUp, req, reqSeen, answered, dpc,
                  dseen, sawErase, result, keys, sentAfterErase, eseen, marked, removed,
                  idx, crashes, retries, outages >>

Remove ==
  /\ epc = "removing"
  /\ rec' = "absent"
  /\ pend' = "none"
  /\ erasedKey' = TRUE
  /\ removed' = TRUE
  /\ IF IndexAfterRecord
       THEN /\ idx' = [idx EXCEPT !["eraser"] = "clear"]
            /\ UNCHANGED indexed
       ELSE /\ indexed' = FALSE
            /\ UNCHANGED idx
  /\ epc' = "clearing"
  /\ UNCHANGED << events, basinUp, req, reqSeen, answered, dpc, dseen, sawErase, result,
                  keys, sentAfterErase, eseen, marked, tombstoned, crashes, retries, outages >>

EraseDone ==
  /\ epc = "clearing"
  /\ idx["eraser"] = "none"
  /\ epc' = "done"
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, req, reqSeen, answered,
                  dpc, dseen, sawErase, result, keys, sentAfterErase, eseen, marked,
                  tombstoned, removed, idx, crashes, retries, outages >>

BasinDown ==
  /\ basinUp
  /\ outages < MaxOutages
  /\ basinUp' = FALSE
  /\ outages' = outages + 1
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, req, reqSeen, answered, dpc, dseen,
                  sawErase, result, keys, sentAfterErase, epc, eseen, marked, tombstoned,
                  removed, idx, crashes, retries >>

BasinBack ==
  /\ ~basinUp
  /\ basinUp' = TRUE
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, req, reqSeen, answered, dpc, dseen,
                  sawErase, result, keys, sentAfterErase, epc, eseen, marked, tombstoned,
                  removed, idx, crashes, retries, outages >>

InFlight(w) ==
  CASE w = "request" -> req \in {"held", "recorded", "read", "committing"}
    [] w = "eraser" -> epc \in {"marking", "flushing", "tombstoning", "removing", "clearing"}
    [] OTHER -> dpc[w] # "idle"

Crash(w) ==
  /\ crashes < MaxCrashes
  /\ InFlight(w)
  /\ crashes' = crashes + 1
  /\ idx' = [idx EXCEPT ![w] = "none"]
  /\ req' = IF w = "request" THEN "dead" ELSE req
  /\ dpc' = IF w \in Deliverers THEN [dpc EXCEPT ![w] = "idle"] ELSE dpc
  /\ epc' = CASE w # "eraser" -> epc
              [] epc = "marking" -> "idle"
              [] epc = "clearing" -> "done"
              [] OTHER -> "parked"
  /\ UNCHANGED << rec, pend, indexed, erasedKey, events, basinUp, reqSeen, answered, dseen,
                  sawErase, result, keys, sentAfterErase, eseen, marked, tombstoned, removed,
                  retries, outages >>

Init ==
  /\ rec = "absent"
  /\ pend = "none"
  /\ indexed = FALSE
  /\ erasedKey = FALSE
  /\ events = "none"
  /\ basinUp = TRUE
  /\ req = "start"
  /\ reqSeen = [rec |-> "absent", pend |-> "none"]
  /\ answered = FALSE
  /\ dpc = [d \in Deliverers |-> "idle"]
  /\ dseen = [d \in Deliverers |-> [rec |-> "absent", pend |-> "none"]]
  /\ sawErase = [d \in Deliverers |-> FALSE]
  /\ result = [d \in Deliverers |-> "refused"]
  /\ keys = {}
  /\ sentAfterErase = FALSE
  /\ epc = "idle"
  /\ eseen = [rec |-> "absent", pend |-> "none"]
  /\ marked = FALSE
  /\ tombstoned = FALSE
  /\ removed = FALSE
  /\ idx = [w \in Writers |-> "none"]
  /\ crashes = 0
  /\ retries = 0
  /\ outages = 0

RequestStep == SaveHeld \/ RecordEvents \/ CommitRead \/ CommitWrite \/ Answer

DeliveryStep(d) ==
  DeliveryRead(d) \/ DeliverySend(d) \/ SettleRead(d) \/ SettleWrite(d) \/ DeliveryDone(d)

EraseStep == EraseMark \/ EraseMarked \/ Tombstone \/ Remove \/ EraseDone

Next ==
  \/ RequestStep
  \/ SweepVisit
  \/ \E d \in Deliverers : DeliveryStep(d)
  \/ EraseRead
  \/ EraseStep
  \/ \E w \in Writers : FlushIndex(w)
  \/ \E w \in Writers : PreMark(w)
  \/ BasinDown
  \/ BasinBack
  \/ \E w \in Writers : Crash(w)

Fairness ==
  /\ WF_vars(RequestStep)
  /\ WF_vars(SweepVisit)
  /\ WF_vars(DeliveryStep("background"))
  /\ WF_vars(DeliveryStep("sweep"))
  /\ WF_vars(EraseStep)
  /\ WF_vars(FlushIndex("request"))
  /\ WF_vars(FlushIndex("background"))
  /\ WF_vars(FlushIndex("sweep"))
  /\ WF_vars(FlushIndex("eraser"))
  /\ \A w \in Writers : WF_vars(PreMark(w))
  /\ WF_vars(BasinBack)

Spec == Init /\ [][Next]_vars /\ Fairness

====
