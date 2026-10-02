// ---------------------------------------------------------------------------
// The portal's async UX layer. Import from here for new code.
//
//   Reads        → useAsync (live.tsx) + <AsyncBlock> + a skeleton from ui.tsx
//   Mutations    → useAsyncAction  (button loading + toast lifecycle + dupe guard)
//   Destructive  → confirmAndRun   (confirm → in-dialog spinner → toast)
//   Uploads      → useUploadQueue + <UploadList>  (real, measured progress)
//   Anything     → toast.*         (loading / success / error / warning / info)
//
// `toast` and `ToastStack` are also re-exported from ui.tsx, which is where the
// ~450 existing call sites import them from. Both point at the same instance.
//
// Mirrors boatpro/src/async and boatpro-provider/src/async so a pattern learned
// in one app transfers to the others.
// ---------------------------------------------------------------------------
export {
  ApiError,
  toApiError,
  apiErrorFromResponse,
  errorMessage,
  fieldErrors,
  describeFieldErrors,
  humanizeField,
  kindForStatus,
  type ApiErrorKind,
} from './errors';

export {
  toast,
  ToastStack,
  dismiss as dismissToast,
  TOAST_DURATION,
  type ToastTone,
  type ToastItem,
  type ToastAction,
  type ShowOptions,
  type PromiseToastCopy,
} from './toast';

export {
  useAsyncAction,
  useDelayedFlag,
  useUnloadGuard,
  type AsyncStatus,
  type AsyncActionState,
  type AsyncActionOptions,
} from './hooks';

export {
  useUploadQueue,
  type UploadItem,
  type UploadStatus,
  type UploadSummary,
  type Uploader,
} from './upload';
export { UploadList, UploadSummaryLine } from './UploadList';

export { confirm, confirmAndRun, ConfirmHost, type ConfirmRequest, type ConfirmAndRunOptions } from './confirm';

export {
  beginActivity,
  endActivity,
  withActivity,
  useIsNetworkBusy,
  blockNavigation,
  useNavigationBlockReason,
  getNavigationBlockReason,
} from './activity';
export { RouteProgressBar } from './RouteProgressBar';
export { LoadingOverlay, LoaderGlyph, type LoaderVariant } from './LoadingOverlay';
