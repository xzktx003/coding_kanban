import { createContext, useContext } from "react";
/** A side-panel reader may answer its own RPC requests but never edit/roll back history. */
export const TranscriptInspectionContext = createContext(false);
export const useTranscriptInspection = () =>
  useContext(TranscriptInspectionContext);
