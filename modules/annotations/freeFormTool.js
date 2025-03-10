OSDAnnotations.FreeFormTool = class {
    /**
     * Create manager for object modification: draw on canvas to add (add=true) or remove (add=false)
     *   parts of fabric.js object, non-vertex-lie objects implement 'toPointArray' to convert them to polygon
     *   (or can return null, in that case it is not possible to use it)
     * @param {string} selfName name of the (self) element property inside parent (not used)
     * @param {OSDAnnotations} context
     */
    constructor(selfName, context) {
        this.polygon = null;
        this.modeAdd = true;
        this.screenRadius = 20;
        this.radius = 20;
        this.mousePos = null;
        this.SQRT3DIV2 = 0.866025403784;
        this._context = context;
        this._update = null;
        this._created = false;
        this._node = null;

        USER_INTERFACE.addHtml(`<div id="annotation-cursor" class="${this._context.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>`,
            this._context.id);
        this._node = document.getElementById("annotation-cursor");
    }

    /**
     * Initialize object for modification
     * @param {object} object fabricjs object
     * @param {boolean|Array<object>} created true if the object has been just created, e.g.
     *    the object is yet not on the canvas, the given object is appended to the canvas and modified directly,
     *    not copied (unless it is an implicit object)
     *    can be also an array of points: in this case fft will consider the created as a polygonized
     *    object data and re-use these to construct first iteration, this means you can explicitly
     *    provide also polygon version of the target object if its factory does not support supportsBrush
     */
    init(object, created=false) {
        let objectFactory = this._context.getAnnotationObjectFactory(object.factoryID);
        this._created = created;

        if (objectFactory !== undefined) {
            if (objectFactory.factoryID !== "polygon") {  //object can be used immedietaly
                let points = Array.isArray(created) ? points : (
                    objectFactory.supportsBrush() ?
                        objectFactory.toPointArray(object,
                            OSDAnnotations.AnnotationObjectFactory.withObjectPoint, 1) : undefined
                );

                if (points) {
                    this._createPolygonAndSetupFrom(points, object);
                } else {
                    Dialogs.show("This object cannot be modified.", 5000, Dialogs.MSG_WARN);
                    return;
                }
            } else {
                let newPolygon = created ? object : this._context.polygonFactory.copy(object, object.points);
                this._setupPolygon(newPolygon, object);

            }
        } else {
            this.polygon = null;
            //todo rather throw error
            Dialogs.show("Error: invalid usage.", 5000, Dialogs.MSG_WARN);
            return;
        }
        this.mousePos = {x: -99999, y: -9999}; //first click can also update
        this.simplifier = OSDAnnotations.PolygonUtilities.simplify.bind(OSDAnnotations.PolygonUtilities);
        this._updatePerformed = false;
    }

    /**
     * Update cursor indicator radius
     */
    updateCursorRadius() {
        let screenRadius = this.radius * VIEWER.scalebar.imagePixelSizeOnScreen() * 2;
        if (this._node) {
            this._node.style.width = screenRadius + "px";
            this._node.style.height = screenRadius + "px";
        }
    }

    /**
     * Show cursor radius indicator
     */
    showCursor() {
        if (this._listener) return;
        this._node.style.display = "block";
        this.updateCursorRadius();
        this._node.style.top = "0px";
        this._node.style.left = "0px";

        const c = this._node;
        this._listener = e => {
            c.style.top = e.pageY + "px";
            c.style.left = e.pageX + "px";
        };
        window.addEventListener("mousemove", this._listener);
    }

    /**
     * Hide cursor radius indicator
     */
    hideCursor() {
        if (!this._listener) return;
        this._node.style.display = "none";
        window.removeEventListener("mousemove", this._listener);
        this._listener = null;
    }

    /**
     * Get current mode
     * @return {boolean} true if mode 'add' is active
     */
    get isModeAdd() {
        return this._update === this._subtract;
    }

    /**
     * Set the mode to add/subtract
     * @param {boolean} isModeAdd true if the mode is adding
     * @event free-form-tool-mode-add
     */
    setModeAdd(isModeAdd) {
        this.modeAdd = isModeAdd;
        if (isModeAdd) this._update = this._union;
        else this._update = this._subtract;
        this._context.raiseEvent('free-form-tool-mode-add', {isModeAdd: isModeAdd});
    }

    /**
     * Refresh radius computation.
     */
    recomputeRadius() {
        this.setSafeRadius(this.screenRadius);
    }

    /**
     * Set radius with bounds checking
     * @param {number} radius radius to set, in screen space
     * @param {number} max maximum value allowed, default 100
     */
    setSafeRadius(radius, max=100) {
        this.setRadius(Math.min(Math.max(radius, 3), max));
    }

    /**
     * Set the tool radius, in screen coordinates
     * @param {number} radius in screen pixels
     */
    setRadius (radius) {
        let imageTileSource = VIEWER.scalebar.getReferencedTiledImage();
        let pointA = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(radius*2, 0));
        //no need for euclidean distance, vector is horizontal
        this.radius = Math.round(Math.abs(pointB.x - pointA.x));
        if (this.screenRadius !== radius) this.updateCursorRadius();
        this.screenRadius = radius;
        this._context.raiseEvent('free-form-tool-radius', {radius: radius});
    }

    /**
     * Get a polygon points approximating current tool radius
     * @param {object} fromPoint center in image space
     * @param {number} fromPoint.x
     * @param {number} fromPoint.y
     * @return {{x: number, y: number}[]} points
     */
    getCircleShape(fromPoint) {
        let diagonal1 = this.radius * 0.5;
        let diagonal2 = this.radius * this.SQRT3DIV2;
        return [
            { x: fromPoint.x - this.radius, y: fromPoint.y },
            { x: fromPoint.x - diagonal2, y: fromPoint.y + diagonal1 },
            { x: fromPoint.x - diagonal1, y: fromPoint.y + diagonal2 },
            { x: fromPoint.x, y: fromPoint.y + this.radius },
            { x: fromPoint.x + diagonal1, y: fromPoint.y + diagonal2 },
            { x: fromPoint.x + diagonal2, y: fromPoint.y + diagonal1 },
            { x: fromPoint.x + this.radius, y: fromPoint.y },
            { x: fromPoint.x + diagonal2, y: fromPoint.y - diagonal1 },
            { x: fromPoint.x + diagonal1, y: fromPoint.y - diagonal2 },
            { x: fromPoint.x, y: fromPoint.y - this.radius },
            { x: fromPoint.x - diagonal1, y: fromPoint.y - diagonal2 },
            { x: fromPoint.x - diagonal2, y: fromPoint.y - diagonal1 },
        ]
    }

    /**
     * Update polygon adjustment by current mouse position, a radius
     * is measured and the circle added to / removed from the current volume
     * @param {object} point point in image space (absolute pixels)
     * @param {number} point.x
     * @param {number} point.y
     */
    update(point) {
        //todo check if contains NaN values and exit if so abort
        if (!this.polygon) {
            return;
        }

        try {
            this._updatePerformed = this._update(point) || this._updatePerformed;

            if (this.polygon) {
                this.polygon._setPositionDimensions({});
                this._context.canvas.renderAll();
            }
        } catch (e) {
            console.warn("FreeFormTool: something went wrong, ignoring...", e);
        }
    }

    /**
     * Check if free form tool is in active mode
     * @return {boolean}
     */
    isRunning() {
        return !!this.polygon;
    }

    /**
     * Finalize the object modification
     * @return {fabric.Polygon | null} polygon if successfully updated
     */
    finish (_withDeletion=false) {
        if (this.polygon) {
            delete this.initial.moveCursor;
            delete this.polygon.moveCursor;

            //fixme still small problem - updated annotaion gets replaced in the board, changing its position!
            if (_withDeletion) {
                //revert annotation replacement and delete the initial (annotation was erased by modification)
                this._context.replaceAnnotation(this.polygon, this.initial, true);
                this._context.deleteAnnotation(this.initial);
            } else if (!this._created) {
                //revert annotation replacement and when updated, really swap
                this._context.replaceAnnotation(this.polygon, this.initial, true);
                if (this._updatePerformed) {
                    this._context.replaceAnnotation(this.initial, this.polygon);
                }
            } else {
                this._context.deleteHelperAnnotation(this.polygon);
                this._context.addAnnotation(this.polygon);
            }
            this._created = false;
            let outcome = this.polygon;
            this.polygon = null;
            this.initial = null;
            this.mousePos = null;
            this._updatePerformed = false;
            return outcome;
        }
        return null;
    }

    //TODO sometimes the greinerHormann cycling, vertices are NaN values, do some measurement and kill after it takes too long (2+s ?)
    _union (nextMousePos) {
        if (!this.polygon || this._toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return false;

        let radPoints = this.getCircleShape(nextMousePos);
        //console.log(radPoints);
        let polyPoints = this.polygon.get("points");
        //avoid 'Leaflet issue' - expecting a polygon that is not 'closed' on points (first != last)
        if (this._toDistancePointsAsObjects(polyPoints[0], polyPoints[polyPoints.length - 1]) < this.radius) polyPoints.pop();
        this.mousePos = nextMousePos;

        let calcSize = OSDAnnotations.PolygonUtilities.approximatePolygonArea;

        //compute union
        try {
            var union = greinerHormann.union(polyPoints, radPoints);
        } catch (e) {
            console.warn("Unable to unify polygon with tool.", this.polygon, radPoints, e);
            return false;
        }

        if (union) {
            if (typeof union[0][0] === 'number') { // single linear ring
                return false;
            }

            if (union.length > 1) union = this._unify(union);

            let maxIdx = 0,maxScore = 0;
            for (let j = 0; j < union.length; j++) {
                let measure = calcSize(union[j]);
                if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
                let area = measure.diffX * measure.diffY;
                let score = 2*area + union[j].length;
                if (score > maxScore) {
                    maxScore = score;
                    maxIdx = j;
                }
            }
            this.polygon.set({points: this.simplifier(union[maxIdx])});
            return true;
        }
        return false;
    }

    //initialize object so that it is ready to be modified
    _setupPolygon(polyObject, original) {
        this.polygon = polyObject;
        this.initial = original;

        if (!this._created) {
            this._context.replaceAnnotation(original, polyObject, true);
        } else {
            this._context.addHelperAnnotation(polyObject);
        }

        polyObject.moveCursor = 'crosshair';
    }

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom(points, object) {
        let polygon = this._context.polygonFactory.copy(object, points);
        polygon.factoryID = this._context.polygonFactory.factoryID;
        this._setupPolygon(polygon, object);
    }

    //try to merge polygon list into one polygons using 'greinerHormann.union' repeated call and simplyfiing the polygon
    _unify(unions) {
        let i = 0, len = unions.length ** 2 + 10, primary = [], secondary = [];

        unions.forEach(u => {
            primary.push(this.simplifier(u));
        });
        while (i < len) {
            if (primary.length < 2) break;

            i++;
            let j = 0;
            for (; j < primary.length - 1; j += 2) {
                let ress = greinerHormann.union(primary[j], primary[j + 1]);

                if (typeof ress[0][0] === 'number') {
                    ress = [ress];
                }
                secondary = ress.concat(secondary); //reverse order for different union call in the next loop
            }
            if (j === primary.length - 1) secondary.push(primary[j]);
            primary = secondary;
            secondary = [];
        }
        return primary;
    }

    _subtract (nextMousePos) {
        if (!this.polygon || this._toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return false;

        let radPoints = this.getCircleShape(nextMousePos);
        let polyPoints = this.polygon.get("points");
        this.mousePos = nextMousePos;

        let calcSize = OSDAnnotations.PolygonUtilities.approximatePolygonArea;

        try {
            var difference = greinerHormann.diff(polyPoints, radPoints);
        } catch (e) {
            console.warn("Unable to diff polygon with tool.", this.polygon, radPoints, e);
            return false;
        }

        if (difference) {
            let polygon;
            if (typeof difference[0][0] === 'number') { // single linear ring
                polygon = this.simplifier(difference);
            } else {
                if (difference.length > 1) difference = this._unify(difference);

                let maxIdx = 0, maxArea = 0, maxScore = 0;
                for (let j = 0; j < difference.length; j++) {
                    let measure = calcSize(difference[j]);
                    if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
                    let area = measure.diffX * measure.diffY;
                    let score = 2*area + difference[j].length;
                    if (score > maxScore) {
                        maxArea = area;
                        maxScore = score;
                        maxIdx = j;
                    }
                }

                if (maxArea < this.radius * this.radius / 2) {  //largest area ceased to exist: finish
                    delete this.initial.moveCursor;
                    delete this.polygon.moveCursor;
                    this.finish(true);
                    return true;
                }

                polygon = this.simplifier(difference[maxIdx]);
            }
            this.polygon.set({points: polygon});
            return true;
        }
        return false;
    }

    _toDistancePointsAsObjects(pointA, pointB) {
        return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    }
};
