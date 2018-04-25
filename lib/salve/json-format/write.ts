/**
 * This module contains classes for walking a parsed tree.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

import { ConversionWalker, Element, Node } from "../conversion";
import { nameToCode, OPTION_NO_PATHS } from "./common";

type ConstructState = {
  open: string;
  close: string;
  first: boolean;
};

/**
 * [[ConversionWalker]] for the default version generated by salve.
 */
class DefaultConversionWalker extends ConversionWalker {
  protected readonly arrayStart: string | number;
  protected inNameClass: boolean = false;
  protected _output: string = "";

  /**
   * @param version The version of the format to produce.
   *
   * @param includePaths Whether to include paths in the output.
   *
   * @param verbose Whether to output verbosely.
   *
   * @throws {Error} If the version requested in ``version`` is not supported.
   */
  constructor(version: number, readonly includePaths: boolean = false,
              readonly verbose: boolean = false) {
    super();
    if (version !== 3) {
      throw new Error("DefaultConversionWalker only supports version 3");
    }
    this.arrayStart = this.verbose ? "\"Array\"" : 0;
  }

  /** The output of the conversion. */
  get output(): string {
    return this._output;
  }

  private _constructState: ConstructState[] =
    [{ open: "", close: "", first: true }];

  /**
   * Resets the walker to a blank state. This allows using the same walker for
   * multiple walks.
   */
  reset(): void {
    this._output = "";
    this._constructState = [{ open: "", close: "", first: true }];
  }

  /**
   * Opens a construct in the output.
   *
   * @param open The opening string.
   *
   * @param close The closing string. This will be used to check that the
   * construct is closed properly.
   */
  openConstruct(open: string, close: string): void {
    this._constructState.unshift({ open, close, first: true });
    this._output += open;
  }

  /**
   * Closes a construct in the output.
   *
   * @param close The closing string. This will be used to check that the
   * construct is closed properly.
   *
   * @throws {Error} If the ``close`` parameter does not match what was passed
   * to [[openConstruct]].
   */
  closeConstruct(close: string): void {
    const top = this._constructState.shift();
    if (top !== undefined) {
      if (close !== top.close) {
        throw new Error(`construct mismatch: ${top.close} vs ${close}`);
      }
      this._output += close;
    }
  }

  /**
   * Indicates that a new item is about to start in the current construct.
   * Outputs a separator (",") if this is not the first item in the construct.
   */
  newItem(): void {
    const top = this._constructState[0];
    if (top.first) {
      top.first = false;

      return;
    }
    this._output += ",";
  }

  /**
   * Outputs an item in the current construct. Outputs a separator (",") if this
   * is not the first item in the construct.
   *
   * @param item The item to output.
   */
  outputItem(item: string | number): void {
    this.newItem();
    this._output += (typeof item === "number") ? item.toString() : item;
  }

  /**
   * Outputs a string in the current construct. Outputs a separator (",") if
   * this is not the first item in the construct. The double-quotes in the
   * string will be escaped and the string will be surrounded by double quotes
   * in the output.
   *
   * @param thing The string to output.
   */
  outputAsString(thing: string | Node): void {
    this.newItem();
    const text = (thing instanceof Node ? thing.text : thing)
      .replace(/(["\\])/g, "\\$1");
    this._output += `"${text}"`;
  }

  /**
   * Open an array in the output.
   */
  openArray(): void {
    this.openConstruct("[", "]");
    this.outputItem(this.arrayStart);
  }

  // tslint:disable-next-line: max-func-body-length
  walk(el: Element): void {
    const elName = el.local;
    switch (elName) {
      case "start":
        this.walkChildren(el);
        break;
      case "param":
        this.outputAsString(el.mustGetAttribute("name"));
        this.outputAsString(el.children[0]);
        break;
      case "grammar": {
        this.openConstruct("{", "}");
        this.outputItem(`"v":3,"o":${this.includePaths ? 0 :
OPTION_NO_PATHS},"d":`);
        // tslint:disable:no-string-literal
        const ctor = nameToCode["Grammar"];
        if (ctor === undefined) {
          throw new Error("can't find constructor for Grammar");
        }
        this.openConstruct("[", "]");
        if (this.verbose) {
          this.outputAsString("Grammar");
        }
        else {
          this.outputItem(ctor);
        }
        if (this.includePaths) {
          this.outputAsString(el.path);
        }
        this.walk(el.children[0] as Element);
        this.newItem();
        this.openArray();
        this.walkChildren(el, 1);
        this.closeConstruct("]");
        this.closeConstruct("]");
        this.closeConstruct("}");
        break;
      }
      default: {
        let capitalized: string = el.local.charAt(0).toUpperCase() +
          el.local.slice(1);
        const skipToChildren: boolean = (capitalized === "Except");
        if (this.inNameClass) {
          // When we are in an name class, some elements are converted
          // differently from when outside it. For instance, choice can appear
          // as a general pattern to encode a choice between two elements or
          // two attributes, and it can be used inside a name class to encode a
          // choice between two names. We convert such elements to a different
          // class.
          if (capitalized === "Choice") {
            capitalized = "NameChoice";
          }
        }

        // We do not output anything for this element itself but instead go
        // straight to its children.
        if (skipToChildren) {
          this.walkChildren(el);

          return;
        }

        this.newItem();
        const ctor = nameToCode[capitalized];
        if (ctor === undefined) {
          throw new Error(`can't find constructor for ${capitalized}`);
        }

        this.openConstruct("[", "]");
        if (this.verbose) {
          this.outputAsString(capitalized);
        }
        else {
          this.outputItem(ctor);
        }
        if (this.includePaths) {
          this.outputAsString(el.path);
        }

        switch (elName) {
          case "ref": {
            const name = el.mustGetAttribute("name");
            if (/^\d+$/.test(name)) {
              this.outputItem(parseInt(name));
            }
            else {
              this.outputAsString(name);
            }
            break;
          }
          case "define": {
            const name = el.mustGetAttribute("name");
            if (/^\d+$/.test(name)) {
              this.outputItem(parseInt(name));
            }
            else {
              this.outputAsString(name);
            }
            this.newItem();
            this.openArray();
            this.walkChildren(el);
            this.closeConstruct("]");
            break;
          }
          case "value": {
            // Output a variable number of items.
            // Suppose item 0 is called it0 and so forth. Then:
            //
            // Number of items  value  type    datatypeLibrary  ns
            // 1                it0    "token" ""               ""
            // 2                it0     it1    ""               ""
            // 3                it0     it1    it2              ""
            // 4                it0     it1    it2              it3
            //
            this.outputAsString(el);
            const typeAttr = el.mustGetAttribute("type");
            const datatypeLibraryAttr = el.mustGetAttribute("datatypeLibrary");
            const nsAttr = el.mustGetAttribute("ns");
            if (typeAttr !== "token" || datatypeLibraryAttr !== "" ||
                nsAttr !== "") {
              this.outputAsString(typeAttr);
              if (datatypeLibraryAttr !== "" || nsAttr !== "") {
                this.outputAsString(datatypeLibraryAttr);
                // No value === empty string.
                if (nsAttr !== "") {
                  this.outputAsString(nsAttr);
                }
              }
            }
            break;
          }
          case "data": {
            // Output a variable number of items.
            // Suppose item 0 is called it0 and so forth. Then:
            //
            // Number of items  type    datatypeLibrary params except
            // 0                "token" ""              {}     undefined
            // 1                it0     ""              {}     undefined
            // 2                it0     it1             {}     undefined
            // 3                it0     it1             it2    undefined
            // 4                it0     it1             it2    it3
            //
            // Parameters are necessarily first among the children.
            const hasParams: boolean =
              (el.children.length !== 0 &&
               ((el.children[0] as Element).local === "param"));
            // Except is necessarily last.
            const hasExcept: boolean =
              (el.children.length !== 0 &&
               (el.children[el.children.length - 1] as Element).local ===
               "except");

            const typeAttr = el.mustGetAttribute("type");
            const datatypeLibraryAttr = el.mustGetAttribute("datatypeLibrary");
            if (typeAttr !== "token" || datatypeLibraryAttr !== "" ||
                hasParams || hasExcept) {
              this.outputAsString(typeAttr);
              if (datatypeLibraryAttr !== "" || hasParams || hasExcept) {
                this.outputAsString(datatypeLibraryAttr);
                if (hasParams || hasExcept) {
                  this.newItem();
                  this.openArray();
                  if (hasParams) {
                    this.walkChildren(el, 0,
                                      hasExcept ? el.children.length - 1 :
                                      undefined);
                  }
                  this.closeConstruct("]");
                  if (hasExcept) {
                    this.walk(el.children[el.children.length - 1] as Element);
                  }
                }
              }
            }
            break;
          }
          case "group":
          case "interleave":
          case "choice":
          case "oneOrMore":
            this.newItem();
            this.openArray();
            this.walkChildren(el);
            this.closeConstruct("]");
            break;
          case "element":
          case "attribute":
            // The first element of `<element>` or `<attribute>` is necessarily
            // a name class. Note that there is no need to worry about recursion
            // since it is not possible to get here recursively from the
            // `this.walk` call that follows. (A name class cannot contain
            // `<element>` or `<attribute>`.
            this.inNameClass = true;
            this.walk(el.children[0] as Element);
            this.inNameClass = false;
            this.newItem();
            this.openArray();
            this.walkChildren(el, 1);
            this.closeConstruct("]");
            break;
          case "name":
            this.outputAsString(el.mustGetAttribute("ns"));
            this.outputAsString(el);
            break;
          case "nsName":
            this.outputAsString(el.mustGetAttribute("ns"));
            this.walkChildren(el);
            break;
          default:
            this.walkChildren(el);
        }
        this.closeConstruct("]");
      }
    }
  }
}

/**
 * A [[ConversionWalker]] specialized in gathering the names used for Relax NG's
 * ``<ref>`` and ``<define>`` elements.
 */
class NameGatherer extends ConversionWalker {
  /**
   * The names gathered. Each name is associated with the number of times it
   * was seen. This property is valid after the walker has walked the element
   * tree.
   */
  readonly names: {[name: string]: number} =  Object.create(null);

  walk(el: Element): void {
    this.walkChildren(el);
    if (el.local === "define" || el.local === "ref") {
      const name: string = el.mustGetAttribute("name");
      if (!(name in this.names)) {
        this.names[name] = 0;
      }

      this.names[name]++;
    }
  }
}

/**
 * A [[ConversionWalker]] specialized in reassigning the names used by Relax
 * NG's ``<ref>`` and ``<define>`` elements.
 *
 * @param names This is a map whose keys are the names that already exist in the
 * element tree and the values are the new names to use. A ``(key, value)`` pair
 * indicates that ``key`` should be replaced with ``value``. It is up to the
 * caller to ensure that two keys do not share the same value and that the map
 * is complete.
 */
class Renamer extends ConversionWalker {
  constructor(protected names: {[name: string]: string}) {
    super();
  }

  walk(el: Element): void {
    if (el.local === "define" || el.local === "ref") {
      el.setAttribute("name", this.names[el.mustGetAttribute("name")]);
    }
    this.walkChildren(el);
  }
}

/**
 * Rename the ``ref`` and ``define`` elements in a schema. The modifications are
 * done in-place. The new names are numbers. Using numbers saves some characters
 * because numbers can be put as-is in JSON (whereas strings require
 * delimiters). Lower numbers are assigned to the most frequent names, so as to
 * optimize for lower final JSON size.
 *
 * @param tree The schema to modify, in the form of a tree of elements.
 */
export function renameRefsDefines(tree: Element): void {
  // Gather names
  const g = new NameGatherer();
  g.walk(tree);
  const names = g.names;

  // Now assign new names with shorter new names being assigned to those
  // original names that are most frequent.
  const sorted = Object.keys(names)
    .map((key) => ({ key: key, freq: names[key] }));
  // Yes, we want to sort in reverse order of frequency, highest first.
  sorted.sort((a, b) => b.freq - a.freq);

  // The map has to be from string to string because in general we may use other
  // renaming schemes. However, the code that generates the JSON checks whether
  // the string is a number and stores a number in the JSON.
  const newNames: Record<string, string> = {};
  let id = 1;
  sorted.forEach((elem) => {
    newNames[elem.key] = String(id++);
  });

  // Perform the renaming.
  const renamer = new Renamer(newNames);
  renamer.walk(tree);
}

export function writeTreeToJSON(tree: Element, formatVersion: number,
                                includePaths: boolean = false,
                                verbose: boolean = false): string {
  const walker = new DefaultConversionWalker(formatVersion, includePaths,
                                             verbose);
  walker.walk(tree);

  return walker.output;
}
