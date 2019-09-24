import { Path, Point, Color, ToolEvent, Item, Shape, project } from "paper";
import { BubbleSpec, Tip } from "bubbleSpec";
import Comical from "./comical";

// This class should represent a bubble (including the tail) and the methods for drawing a single bubble
export default class Bubble {
  public static getBubble(element: HTMLElement): BubbleSpec {
    const escapedJson = element.getAttribute("data-bubble");
    if (!escapedJson) {
      return Bubble.getDefaultBubble(element, "none");
    }
    const json = escapedJson.replace(/`/g, '"');
    return JSON.parse(json); // enhance: can we usefully validate it?
  }

  public static getDefaultBubble(
    element: HTMLElement,
    style: string
  ): BubbleSpec {
    if (!style || style == "none") {
      return {
        version: Comical.bubbleVersion,
        style: "none",
        tips: [],
        level: 1
      };
    }
    return {
      version: Comical.bubbleVersion,
      style: style,
      tips: [Bubble.makeDefaultTip(element)],
      level: 1
    };
  }

  // Links the bubbleShape with the content element
  public static setBubble(
    bubble: BubbleSpec | undefined,
    element: HTMLElement
  ): void {
    if (bubble) {
      console.assert(
        !!(bubble.version && bubble.level && bubble.tips && bubble.style),
        "Bubble lacks minimum fields"
      );
      const json = JSON.stringify(bubble);
      const escapedJson = json.replace(/"/g, "`");
      element.setAttribute("data-bubble", escapedJson);
    } else {
      element.removeAttribute("data-bubble");
    }
  }

  public static wrapBubbleAroundDivWithTail(
    bubbleStyle: string,
    content: HTMLElement,
    desiredTip?: Tip
  ) {
    Bubble.wrapBubbleAroundDiv(bubbleStyle, content, (bubble: Shape) => {
      let target = bubble!.position!.add(new Point(200, 100));
      let mid = Bubble.defaultMid(bubble!.position!, target);
      if (desiredTip) {
        target = new Point(desiredTip.targetX, desiredTip.targetY);
        mid = new Point(desiredTip.midpointX, desiredTip.midpointY);
      }
      // TODO: This should be called tail: Tail, and targetX should be tipX.
      const tip: Tip = {
        targetX: target.x!,
        targetY: target.y!,
        midpointX: mid.x!,
        midpointY: mid.y!
      };
      if (typeof bubbleStyle === "string") {
        const bubble: BubbleSpec = {
          version: "1.0",
          style: (bubbleStyle as unknown) as string,
          tips: [tip],
          level: 1
        };
        Bubble.setBubble(bubble, content);
      }
      Comical.drawTailOnShapes(
        bubble!.position!,
        mid,
        target,
        [bubble],
        content
      );
    });
  }

  public static wrapBubbleAroundDiv(
    bubbleStyle: string,
    content: HTMLElement,
    whenPlaced: (s: Shape) => void
  ) {
    Bubble.getShape(bubbleStyle, bubble => {
      if (bubble) {
        Bubble.wrapShapeAroundDiv(bubble, content, whenPlaced);
      }
    });
  }

  private static wrapShapeAroundDiv(
    bubble: Shape,
    content: HTMLElement,
    whenPlaced: (s: Shape) => void
  ) {
    // recursive: true is required to see any but the root "g" element
    // (apparently contrary to documentation).
    // The 'name' of a paper item corresponds to the 'id' of an element in the SVG
    const contentHolder = bubble.getItem({
      recursive: true,
      match: (x: any) => {
        return x.name === "content-holder";
      }
    });
    // contentHolder (which should be a rectangle in SVG) comes out as a Shape.
    // (can also cause it to come out as a Path, by setting expandShapes: true
    // in the getItem options).
    // It has property size, with height, width as numbers matching the
    // height and width specified in the SVG for the rectangle.)
    // Also position, which surprisingly is about 50,50...probably a center.
    //contentHolder.fillColor = new Color("cyan");
    contentHolder.strokeWidth = 0;
    const adjustSize = () => {
      var contentWidth = content.offsetWidth;
      var contentHeight = content.offsetHeight;
      if (contentWidth < 1 || contentHeight < 1) {
        // Horrible kludge until I can find an event that fires when the object is ready.
        window.setTimeout(adjustSize, 100);
        return;
      }
      var holderWidth = (contentHolder as any).size.width;
      var holderHeight = (contentHolder as any).size.height;
      bubble.scale(contentWidth / holderWidth, contentHeight / holderHeight);
      const contentLeft = content.offsetLeft;
      const contentTop = content.offsetTop;
      const contentCenter = new Point(
        contentLeft + contentWidth / 2,
        contentTop + contentHeight / 2
      );
      bubble.position = contentCenter;
      whenPlaced(bubble);
    };
    adjustSize();
    //window.addEventListener('load', adjustSize);

    //var topContent = content.offsetTop;
  }

  private static getShape(
    bubbleStyle: string,
    doWithShape: (s: Shape) => void
  ) {
    if (typeof bubbleStyle !== "string") {
      doWithShape(bubbleStyle as Shape);
      return;
    }
    let svg: string = "";
    switch (bubbleStyle) {
      case "speech":
        svg = Bubble.speechBubble();
        break;
      case "shout":
        svg = Bubble.shoutBubble();
        break;
      case "none":
        break;
      default:
        console.log("unknown bubble type; using default");
        svg = Bubble.speechBubble();
    }
    project!.importSVG(svg, {
      onLoad: (item: Item) => {
        doWithShape(item as Shape);
      }
    });
  }

  public static drawTail(
    start: Point,
    mid: Point,
    tip: Point,
    lineBehind?: Item | null,
    elementToUpdate?: HTMLElement
  ): void {
    const tipHandle = this.makeHandle(tip);
    const curveHandle = this.makeHandle(mid);
    let tails = this.makeTail(
      start,
      tipHandle.position!,
      curveHandle.position!,
      lineBehind
    );
    curveHandle.bringToFront();

    let state = "idle";
    tipHandle.onMouseDown = () => {
      state = "dragTip";
    };
    curveHandle.onMouseDown = () => {
      state = "dragCurve";
    };
    tipHandle.onMouseDrag = curveHandle.onMouseDrag = (event: ToolEvent) => {
      if (state === "dragTip") {
        const delta = event.point!.subtract(tipHandle.position!).divide(2);
        tipHandle.position = event.point;
        // moving the curve handle half as much is intended to keep
        // the curve roughly the same shape as the tip moves.
        // It might be more precise if we moved it a distance
        // proportional to how close it is to the tip to begin with.
        // Then again, we may decide to constrain it to stay
        // equidistant from the root and tip.
        curveHandle.position = curveHandle.position!.add(delta);
      } else if (state === "dragCurve") {
        curveHandle.position = event.point;
      } else {
        return;
      }
      tails.forEach(t => t.remove());
      tails = this.makeTail(
        start,
        tipHandle.position!,
        curveHandle.position!,
        lineBehind
      );
      curveHandle.bringToFront();
      if (elementToUpdate) {
        const bubble = Bubble.getBubble(elementToUpdate);
        const tip: Tip = {
          targetX: tipHandle!.position!.x!,
          targetY: tipHandle!.position!.y!,
          midpointX: curveHandle!.position!.x!,
          midpointY: curveHandle!.position!.y!
        };
        bubble.tips[0] = tip; // enhance: for multiple tips, need to figure which one to update
        Bubble.setBubble(bubble, elementToUpdate);
      }
    };
    tipHandle.onMouseUp = curveHandle.onMouseUp = () => {
      state = "idle";
    };
  }

  static makeTail(
    root: Point,
    tip: Point,
    mid: Point,
    lineBehind?: Item | null
  ): Path[] {
    const tailWidth = 25;
    // we want to make the base of the tail a line of length tailWidth
    // at right angles to the line from root to mid
    // centered at root.
    const angleBase = new Point(mid.x! - root.x!, mid.y! - root.y!).angle!;
    const deltaBase = new Point(0, 0);
    deltaBase.angle = angleBase + 90;
    deltaBase.length = tailWidth / 2;
    const begin = root.add(deltaBase);
    const end = root.subtract(deltaBase);

    // The midpoints of the arcs are a quarter base width either side of mid,
    // offset at right angles to the root/tip line.
    const angleMid = new Point(tip.x! - root.x!, tip.y! - root.y!).angle!;
    const deltaMid = new Point(0, 0);
    deltaMid.angle = angleMid + 90;
    deltaMid.length = tailWidth / 4;
    const mid1 = mid.add(deltaMid);
    const mid2 = mid.subtract(deltaMid);

    const pathstroke = new Path.Arc(begin, mid1, tip);
    const pathArc2 = new Path.Arc(tip, mid2, end);
    pathstroke.addSegments(pathArc2.segments!);
    pathArc2.remove();
    const pathFill = pathstroke.clone() as Path;
    pathstroke.strokeColor = new Color("black");
    if (lineBehind) {
      pathstroke.insertBelow(lineBehind);
    }
    pathFill.fillColor = Comical.backColor;
    return [pathstroke, pathFill];
  }

  // TODO: Help? where should I be? I think this comes up with unique names.
  static handleIndex = 0;

  static makeHandle(tip: Point): Path.Circle {
    const result = new Path.Circle(tip, 8);
    result.strokeColor = new Color("aqua");
    result.strokeWidth = 2;
    result.fillColor = new Color("white");
    // We basically want the bubbles transparent, especially for the tip, so
    // you can see where the tip actually ends up. But if it's perfectly transparent,
    // paper.js doesn't register hit tests on the transparent part. So go for a very
    // small alpha.
    result.fillColor.alpha = 0.01;
    result.name = "handle" + Bubble.handleIndex++;
    return result;
  }

  public static makeDefaultTip(targetDiv: HTMLElement): Tip {
    const parent: HTMLElement = targetDiv.parentElement as HTMLElement;
    const targetBox = targetDiv.getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    // center of targetbox relative to parent.
    const rootCenter = new Point(
      targetBox.left - parentBox.left + targetBox.width / 2,
      targetBox.top - parentBox.top + targetBox.height / 2
    );
    let targetX = targetBox.left - parentBox.left - targetBox.width / 2;
    if (targetBox.left - parentBox.left < parentBox.right - targetBox.right) {
      // box is closer to left than right...make the tail point right
      targetX = targetBox.right - parentBox.left + targetBox.width / 2;
    }
    let targetY = targetBox.bottom - parentBox.top + 20;
    if (targetY > parentBox.height - 5) {
      targetY = parentBox.height - 5;
    }
    if (targetY < targetBox.bottom - parentBox.top) {
      // try pointing up
      targetY = targetBox.top - parentBox.top - 20;
      if (targetY < 5) {
        targetY = 5;
      }
    }
    // Final checks: make sure the target is at least in the picture.
    if (targetX < 0) {
      targetX = 0;
    }
    if (targetX > parentBox.width) {
      targetX = parentBox.width;
    }
    if (targetY < 0) {
      targetY = 0;
    }
    if (targetY > parentBox.height) {
      targetY = parentBox.height;
    }
    const target = new Point(targetX, targetY);
    const mid: Point = Bubble.defaultMid(rootCenter, target);
    const result: Tip = {
      targetX,
      targetY,
      midpointX: mid.x!,
      midpointY: mid.y!
    };
    return result;
  }

  static defaultMid(start: Point, target: Point): Point {
    const xmid = (start.x! + target.x!) / 2;
    const ymid = (start.y! + target.y!) / 2;
    const deltaX = target.x! - start.x!;
    const deltaY = target.y! - start.y!;
    return new Point(xmid - deltaY / 10, ymid + deltaX / 10);
  }

  public static speechBubble() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
      <svg
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:cc="http://creativecommons.org/ns#"
         xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:svg="http://www.w3.org/2000/svg"
         xmlns="http://www.w3.org/2000/svg"
         id="svg8"
         version="1.1"
         viewBox="0 0 100 100"
         height="100mm"
         width="100mm">
        <defs
           id="defs2" />
        <metadata
           id="metadata5">
          <rdf:RDF>
            <cc:Work
               rdf:about="">
              <dc:format>image/svg+xml</dc:format>
              <dc:type
                 rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
              <dc:title></dc:title>
            </cc:Work>
          </rdf:RDF>
        </metadata>
        <g
           transform="translate(0,-197)"
           id="layer1">
          <ellipse
             ry="49.702854"
             rx="49.608364"
             cy="247.10715"
             cx="50.36533"
             id="path3715"
             style="fill:#ffffff;stroke:#000000;stroke-width:0.26660731;stroke-opacity:1" />
          <rect
            id="content-holder"
            class="content-holder"
             y="214.03423"
             x="13.229166"
             height="65.956848"
             width="74.461304"
             style="fill:none;stroke:#000000;stroke-width:0.26458332;stroke-opacity:1" />
        </g>
      </svg>`;
  }

  public static shoutBubble() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
        <svg
           xmlns:dc="http://purl.org/dc/elements/1.1/"
           xmlns:cc="http://creativecommons.org/ns#"
           xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:svg="http://www.w3.org/2000/svg"
           xmlns="http://www.w3.org/2000/svg"
           id="svg8"
           version="1.1"
           viewBox="0 0 100 100"
           height="100mm"
           width="100mm">
          <defs
             id="defs2" />
          <metadata
             id="metadata5">
            <rdf:RDF>
              <cc:Work
                 rdf:about="">
                <dc:format>image/svg+xml</dc:format>
                <dc:type
                   rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
                <dc:title></dc:title>
              </cc:Work>
            </rdf:RDF>
          </metadata>
          <g
             transform="translate(0,-197)"
             id="layer1">
             <path
             id="path4528"
             d="m 34.773809,223.10566 14.174107,-25.89137 12.662202,25.51339 21.92262,-25.13542 -6.199227,26.04296 19.050415,-5.82123 -18.898809,23.62351 22.489583,8.50447 -22.678569,13.60714 20.78869,31.56101 -39.498513,-24.94643 2.834823,21.73363 -17.386906,-21.73363 -17.575892,27.0253 0.566965,-27.0253 L 4.346726,290.00744 22.489583,258.44643 0.37797618,247.67411 22.867559,235.76786 1.7008928,199.29316 Z"
             style="fill:none;stroke:#000000;stroke-width:0.26458332px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1" />
             <rect
             id="content-holder"
             y="223.63522"
             x="22.830175"
             height="46.376858"
             width="54.503334"
             style="fill:none;stroke:#000000;stroke-width:0.18981449;stroke-opacity:1;fill-opacity:0" />
          </g>
        </svg>`;
  }
}
