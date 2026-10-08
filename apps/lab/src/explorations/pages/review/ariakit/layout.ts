// The layout classes that the workspace and its loading shape share, so the
// page does not move when its run arrives.

/**
 * The frame around the main panel, with a gutter of two steps (`$p={2}`). It
 * is a frame and not a padded element, so the panel takes the radius that is
 * concentric with the shell: the radius of every other sheet.
 */
export const panelGutter = "flex h-full min-h-0 flex-col gap-2";

/**
 * The panel starts at the edge of the list, so the bar of the selected row
 * lies on both. It keeps its gutter to the header, to the window end, and to
 * the window bottom. A narrow window has no list beside the panel.
 */
export const besideList = "@3xl/shell:ps-0";

/** The main panel: a sheet that takes the height that the page has left. */
export const panelClass = "flex min-h-0 flex-1 flex-col";

/**
 * The edge of the main panel, as the `$borderType` of its sheet.
 * The panel starts on the edge of the main area, and the list covers what
 * leaves that area. A ring, the edge of a sheet on the light canvas, lies
 * outside its frame, so the panel would have no edge at the list. A border
 * lies inside the frame in both themes.
 */
export const panelEdge = "border";

/**
 * The room of the stage in the panel. Give it to a frame with the gutter of
 * the panel, so the well takes the corner radius that is concentric with the
 * panel. The variant row above it has the top gutter.
 */
export const stageRoomClass = "flex min-h-0 flex-1 flex-col gap-2 pt-0";

/**
 * The screenshot stepper of the header has one width for every screenshot,
 * and its content starts at its start. So its buttons stay in place when the
 * name changes, and when the panel shows no screenshot. It has the room for
 * a long family with a group and a name (`shell · sidebar-combinations`). In
 * a narrow window it takes a share of the shell, so the run keeps its place
 * at the start.
 */
export const stepperWidth = "w-[min(36em,36cqi)]";

/**
 * The variant row is the size container of its parts: the numbers of the
 * change give way before the variant control does. In a row that is too
 * narrow for the control and `Details`, the button takes a second line.
 */
export const variantRowClass = "@container flex flex-none flex-wrap items-center gap-x-3 gap-y-2";

/** The room of the variant control in its row: the stepper and `All`. */
export const variantNavRoom = "flex min-w-[min(100%,27.5em)] flex-1";

/** Hides a part of the variant row while the row is too narrow for it. */
export const wideRowOnly = "@max-[44rem]:hidden";
