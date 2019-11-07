//import { Color, project, setup, Layer, Point } from "paper";
import { Color, project, setup, Layer, Point, Tool, ToolEvent } from "paper";
//import { Color, project, setup, tool, Layer, Point, Tool } from "paper";

import { Bubble } from "./bubble";
import { uniqueIds } from "./uniqueId";
import { BubbleSpec } from "bubbleSpec";
import { ContainerData } from "./containerData";

// Manages a collection of comic bubbles warpped around HTML elements that share a common parent.
// Each element that has a comic bubble has a data-bubble attribute specifying the appearance
// of the bubble. Comical can help with initializing this to add a bubble to an element.
// The data-bubble attributes contain a modified JSON representation of a BubbleSpec
// describing the bubble.
// Comical is designed to be the main class exported by Comical.js, and provides methods
// for setting things up (using a canvas overlayed on the common parent of the bubbles
// and paper.js shapes) so that the bubbles can be edited by dragging handles.
// It also supports drawing groups of bubbles in layers, with appropriate merging
// of bubbles at the same level.
// As the bubbles are edited using Comical handles, the data-bubble attributes are
// automatically updated. It's also possible to alter a data-bubble attribute using
// external code, and tell Comical to update things to match.
// Finally, Comical can replace a finished bubble canvas with a single SVG, resulting in
// a visually identical set of bubbles that can be rendered without using Canvas and
// Javascript.
export class Comical {
    static backColor = new Color("white");

    static activeContainers = new Map<Element, ContainerData>();

    static activeBubble: Bubble | undefined;

    static activeBubbleListener: ((active: HTMLElement | undefined) => void) | undefined;

    static isDragActive: boolean;
    static currentDraggedBubble: Bubble | undefined;

    public static startEditing(parents: HTMLElement[]): void {
        parents.forEach(parent => Comical.convertBubbleJsonToCanvas(parent));
    }

    public static stopEditing(): void {
        const keys: HTMLElement[] = [];
        Comical.activeContainers.forEach((value, key: HTMLElement) => {
            // Possibly we could just call convertCanvasToSvgImg(key) here,
            // but each such call deletes key from Comical.editElements,
            // so we'd be modifying the collection we're iterating over,
            // which feels dangerous.
            keys.push(key);
        });
        keys.forEach(key => Comical.convertCanvasToSvgImg(key));
    }

    public static convertCanvasToSvgImg(parent: HTMLElement) {
        const canvas = parent.getElementsByTagName("canvas")[0];
        if (!canvas) {
            return;
        }
        const containerData = this.activeContainers.get(parent);
        if (!containerData) {
            console.error("attempting convertCanvasToSvgImg on non-active element");
            return;
        }
        if (containerData.bubbleList.length !== 0) {
            // It's quite plausible for there to be no bubbles;
            // we may have turned on bubble editing just in case one
            // got added. But if none did, we have no handles to clean up,
            // and more importantly, no need to create an SVG.

            // Remove drag handles
            containerData.project
                .getItems({
                    recursive: true,
                    match: (x: any) => {
                        return x.name && x.name.startsWith("handle");
                    }
                })
                .forEach(x => x.remove());
            const svg = containerData.project.exportSVG() as SVGElement;
            svg.classList.add("comical-generated");
            uniqueIds(svg);
            canvas.parentElement!.insertBefore(svg, canvas);
        }
        canvas.remove();
        Comical.stopMonitoring(parent);
        this.activeContainers.delete(parent);
    }

    // This logic is designed to prevent accumulating mutation observers.
    // Not yet fully tested.
    private static stopMonitoring(parent: HTMLElement) {
        const containerData = Comical.activeContainers.get(parent);
        if (containerData) {
            containerData.bubbleList.forEach(bubble => bubble.stopMonitoring());
        }
    }

    // Make the bubble for the specified element (if any) active. This means
    // showing its edit handles. Must first call convertBubbleJsonToCanvas(),
    // passing the appropriate parent element.
    public static activateElement(contentElement: HTMLElement | undefined) {
        let newActiveBubble: Bubble | undefined = undefined;
        if (contentElement) {
            newActiveBubble = Comical.getBubblesInSameCanvas(contentElement).find(x => x.content === contentElement);
        }
        Comical.activateBubble(newActiveBubble);
    }

    // Make active (show handles) the specified bubble.
    public static activateBubble(newActiveBubble: Bubble | undefined) {
        if (newActiveBubble == Comical.activeBubble) {
            return;
        }
        Comical.hideHandles();
        Comical.activeBubble = newActiveBubble;
        if (Comical.activeBubble) {
            Comical.activeBubble.showHandles();
        }
        if (Comical.activeBubbleListener) {
            Comical.activeBubbleListener(Comical.activeBubble ? Comical.activeBubble.content : undefined);
        }
    }

    public static hideHandles() {
        Comical.activeContainers.forEach(container => {
            if (container.handleLayer) {
                container.handleLayer.removeChildren();
            }
        });
    }

    // call after adding or deleting elements with data-bubble
    // assumes convertBubbleJsonToCanvas has been called and canvas exists
    public static update(container: HTMLElement) {
        Comical.stopMonitoring(container);
        const containerData = this.activeContainers.get(container);
        if (!containerData) {
            console.error("invoked update on an element that is not active");
            return; // nothing sensible we can do
        }
        containerData.project.activate();
        while (containerData.project.layers.length > 1) {
            const layer = containerData.project.layers.pop();
            if (layer) {
                layer.remove(); // Erase this layer
            }
        }
        if (containerData.project.layers.length > 0) {
            containerData.project.layers[0].activate();
        }
        containerData.project.activeLayer.removeChildren();

        const elements = container.ownerDocument!.evaluate(
            ".//*[@data-bubble]",
            container,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        const bubbles: Bubble[] = [];
        containerData.bubbleList = bubbles;

        var zLevelList: number[] = [];
        for (let i = 0; i < elements.snapshotLength; i++) {
            const element = elements.snapshotItem(i) as HTMLElement;
            const bubble = new Bubble(element);
            bubbles.push(bubble);

            let zLevel = bubble.getSpecLevel();
            if (!zLevel) {
                zLevel = 0;
            }
            zLevelList.push(zLevel);
        }

        // Ensure that they are in ascending order
        zLevelList.sort();

        // First we need to create all the layers in order. (Because they automatically get added to the end of the project's list of layers)
        // Precondition: Assumes zLevelList is sorted.
        const levelToLayer = {};
        for (let i = 0; i < zLevelList.length; ++i) {
            // Check if different than previous. (Ignore duplicate z-indices)
            if (i == 0 || zLevelList[i - 1] != zLevelList[i]) {
                const zLevel = zLevelList[i];
                var lowerLayer = new Layer();
                var upperLayer = new Layer();
                levelToLayer[zLevel] = [lowerLayer, upperLayer];
            }
        }
        containerData.handleLayer = new Layer();

        // Now that the layers are created, we can go back and place objects into the correct layers and ask them to draw themselves.
        for (let i = 0; i < bubbles.length; ++i) {
            const bubble = bubbles[i];

            let zLevel = bubble.getSpecLevel();
            if (!zLevel) {
                zLevel = 0;
            }

            const [lowerLayer, upperLayer] = levelToLayer[zLevel];
            bubble.setLayers(lowerLayer, upperLayer, containerData.handleLayer);
            bubble.initialize();
        }
    }

    // Get max level of elements in the same canvas as element
    public static getMaxLevel(element: HTMLElement): number {
        const bubblesInSameCanvas = Comical.getBubblesInSameCanvas(element);
        if (bubblesInSameCanvas.length === 0) {
            return 0;
        }
        let maxLevel = Number.MIN_VALUE;
        bubblesInSameCanvas.forEach(b => (maxLevel = Math.max(maxLevel, b.getBubbleSpec().level || 0)));
        return maxLevel;
    }

    public static convertBubbleJsonToCanvas(parent: HTMLElement) {
        const canvas = parent.ownerDocument!.createElement("canvas");
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.classList.add("comical-generated");
        canvas.classList.add("comical-editing");
        const oldSvg = parent.getElementsByClassName("comical-generated")[0];
        if (oldSvg) {
            oldSvg.parentElement!.insertBefore(canvas, oldSvg);
            oldSvg.remove();
        } else {
            parent.insertBefore(canvas, parent.firstChild); // want to use prepend, not in FF45.
        }
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        setup(canvas); // updates the global project variable to a new project associated with this canvas

        this.activeContainers.set(parent, {
            project: project!,
            bubbleList: []
        });
        Comical.update(parent);

        // Event handlers
        const myPaperTool = new Tool();
        myPaperTool.onMouseDrag = (event: ToolEvent) => {
            Comical.handleMouseDrag(event, parent);
        };
        myPaperTool.onMouseUp = (event: ToolEvent) => {
            Comical.isDragActive = false;
        };
    }

    private static handleMouseDrag(event: ToolEvent, parentContainer: HTMLElement): void {
        if (!event || !event.point) {
            return;
        }

        if (!this.isDragActive) {
            const bubble = Comical.getBubbleHitByPoint(parentContainer, event.point);
            if (bubble) {
                bubble.onMouseDrag(event);

                // We need to remember which bubble we're currently dragging, so that if we drag this bubble over other bubbles,
                // there's no potential for us to stop dragging this bubble and start dragging a different bubble which has higher precedence.
                Comical.isDragActive = true;
                Comical.currentDraggedBubble = bubble;
            }
        } else if (Comical.currentDraggedBubble) {
            Comical.currentDraggedBubble.onMouseDrag(event);
        }
    }

    public static setActiveBubbleListener(listener: ((selected: HTMLElement | undefined) => void) | undefined) {
        Comical.activeBubbleListener = listener;
    }

    // Make appropriate JSON changes so that childElement becomes a child of parentElement.
    // This means they are at the same level and, if they don't overlap, a joiner is drawn
    // between them.
    // The conceptual model is that all elements at the same level form a family, provided
    // they have distinct order properties. The one with the lowest order is considered
    // the overall parent. A child can be added to a family by specifying any member of the
    // family as a parentElement. It is expected that both elements are children of
    // the root element most recently configured for Comical with convertBubbleJsonToCanvas().
    public static initializeChild(childElement: HTMLElement, parentElement: HTMLElement) {
        const bubblesInSameCanvas = Comical.getBubblesInSameCanvas(parentElement);
        const parentBubble = bubblesInSameCanvas.find(x => x.content === parentElement);
        if (!parentBubble) {
            console.error("trying to make child of element not already active in Comical");
            return;
        }
        const parentSpec = parentBubble.getBubbleSpec();
        if (!parentSpec.order) {
            // It's important not to use zero for order, since that will be treated
            // as an unspecified order.
            parentSpec.order = 1;
            parentBubble.persistBubbleSpec();
        }
        // enhance: if familyLevel is undefined, set it to a number one greater than
        // any level that occurs in bubblesInSameCanvas.
        let childBubble = bubblesInSameCanvas.find(x => x.content === childElement);
        if (!childBubble) {
            childBubble = new Bubble(childElement);
        }
        const lastInFamily = Comical.getLastInFamily(parentElement);
        const maxOrder = lastInFamily.getBubbleSpec().order || 1;
        const tip = lastInFamily.calculateTailStartPoint();
        const root = childBubble.calculateTailStartPoint();
        const mid = Bubble.defaultMid(root, tip);
        // We deliberately do NOT keep any properties the child bubble already has.
        // Apart from the necessary properties for being a child, it will take
        // all its properties from the parent.
        const newBubbleSpec: BubbleSpec = {
            version: Comical.bubbleVersion,
            style: parentSpec.style,
            tails: [
                {
                    tipX: tip.x!,
                    tipY: tip.y!,
                    midpointX: mid.x!,
                    midpointY: mid.y!,
                    joiner: true
                }
            ],
            level: parentSpec.level,
            order: maxOrder + 1
        };
        childBubble.setBubbleSpec(newBubbleSpec);
        // enhance: we could possibly do something here to make the appropriate
        // shapes for childBubble and the tail that links it to the previous bubble.
        // However, currently our only client always does a fresh convertBubbleJsonToCanvas
        // after making a new child. That will automatically sort things out.
        // Note that getting all the shapes updated properly could be nontrivial
        // if childElement already has a bubble...it may need to change shape, lose tails,
        // change other properties,...
    }

    // Return true if a click at the specified point (relative to the top left
    // of the specified container element) hits something Comical has put into
    // the canvas...any of the bubble shapes, tail shapes, handles.
    public static somethingHit(element: HTMLElement, x: number, y: number): boolean {
        const containerData = Comical.activeContainers.get(element);
        if (!containerData) {
            return false;
        }
        const hitResult = containerData.project.hitTest(new Point(x, y));
        return !!hitResult;
    }

    public static getBubbleHitByPoint(parentContainer: HTMLElement, point: Point): Bubble | undefined {
        const containerData = Comical.activeContainers.get(parentContainer);
        if (!containerData) {
            return undefined;
        }

        // I think it's easier to just iterate through the bubbles and check if they're hit or not.
        // You could try to run hitTest, but that gives you a Paper Item, and then you have to figure out which Bubble the Paper Item belongs to... not any easier.

        // Create a shallow copy so we can mess it without concern.
        const bubbleList = containerData.bubbleList.slice(0);

        // Sort them so that the highest level comes first. If we detect a hit on a higher level bubble, we'll stop and ignore hits on lower level bubbles.
        bubbleList.sort((a, b) => {
            let levelA = a.getBubbleSpec().level;
            if (!levelA) {
                levelA = 0;
            }

            let levelB = b.getBubbleSpec().level;
            if (!levelB) {
                levelB = 0;
            }

            // Sort in DESCENDING order, highest order first
            return levelB - levelA;
        });

        for (let i = 0; i < bubbleList.length; ++i) {
            const bubble = bubbleList[i];
            if (bubble.isHitByPoint(point)) {
                return bubble;
            }
        }

        return undefined;
    }

    private static getBubblesInSameCanvas(element: HTMLElement): Bubble[] {
        const iterator = Comical.activeContainers.entries();
        let result = iterator.next();
        while (!result.done) {
            // result.value is a [container, containerData] pair.
            if (result.value[0].contains(element)) {
                return result.value[1].bubbleList;
            }

            result = iterator.next();
        }
        return [];
    }

    // Get the last element in the family of the given element (belonging to the same
    // canvas and having the same level). Any element in the family can be passed.
    private static getLastInFamily(element: HTMLElement): Bubble {
        const familyLevel = Bubble.getBubbleSpec(element).level;
        const family = Comical.getBubblesInSameCanvas(element)
            .filter(x => x.getBubbleSpec().level === familyLevel && x.getBubbleSpec().order)
            .sort((a, b) => a.getBubbleSpec().order! - b.getBubbleSpec().order!);
        // we set order on parentBubble, so there is at least one in the family.
        return family[family.length - 1];
    }

    public static findChild(bubble: Bubble): Bubble | undefined {
        const familyLevel = bubble.getSpecLevel();
        const orderWithinFamily = bubble.getBubbleSpec().order;
        if (!orderWithinFamily) {
            return undefined;
        }
        const family = Comical.getBubblesInSameCanvas(bubble.content)
            .filter(
                x =>
                    x.getBubbleSpec().level === familyLevel &&
                    x.getBubbleSpec().order &&
                    x.getBubbleSpec().order! > orderWithinFamily
            )
            .sort((a, b) => a.getBubbleSpec().order! - b.getBubbleSpec().order!);
        if (family.length > 0) {
            return family[0];
        }
        return undefined;
    }

    // Return the immediate parent of the bubble, or undefined if it doesn't have one
    public static findParent(bubble: Bubble): Bubble | undefined {
        const ancestors = Comical.findAncestors(bubble);

        if (ancestors && ancestors.length > 0) {
            return ancestors[ancestors.length - 1];
        } else {
            return undefined;
        }
    }

    // Return the ancestors of the bubble. The first item in the array
    // is the earliest ancestor (if any); any intermediate bubbles are returned too.
    public static findAncestors(bubble: Bubble): Bubble[] {
        const familyLevel = bubble.getSpecLevel();
        const orderWithinFamily = bubble.getBubbleSpec().order;
        if (!orderWithinFamily) {
            return [];
        }
        return Comical.getBubblesInSameCanvas(bubble.content)
            .filter(
                x =>
                    x.getBubbleSpec().level === familyLevel &&
                    x.getBubbleSpec().order &&
                    x.getBubbleSpec().order! < orderWithinFamily
            )
            .sort((a, b) => a.getBubbleSpec().order! - b.getBubbleSpec().order!);
    }

    public static findRelatives(bubble: Bubble): Bubble[] {
        const familyLevel = bubble.getSpecLevel();
        const orderWithinFamily = bubble.getBubbleSpec().order;
        if (!orderWithinFamily) {
            return [];
        }
        return Comical.getBubblesInSameCanvas(bubble.content)
            .filter(
                x =>
                    x.getBubbleSpec().level === familyLevel &&
                    x.getBubbleSpec().order &&
                    x.getBubbleSpec().order !== orderWithinFamily
            )
            .sort((a, b) => a.getBubbleSpec().order! - b.getBubbleSpec().order!);
    }

    public static bubbleVersion = "1.0";
}

// planned next steps
// 1. When we wrap a shape around an element, record the shape as the data-bubble attr, a block of json as indicted in the design doc.
// Tricks will be needed if it is an arbitrary SVG.
// 2. Add function ConvertSvgToCanvas(parent). Does more or less the opposite of ConvertCanvasToSvg,
// but using the data-X attributes of children of parent that have them to initialize the canvas paper elements.
// Enhance test code to make Finish button toggle between Save and Edit.
// (Once the logic to create a canvas as an overlay on a parent is in place, can probably get all the paper.js
// stuff out of the test code.)
