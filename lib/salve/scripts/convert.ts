/**
 * Conversion cli tool.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { ArgumentParser } from "argparse";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as sax from "sax";
import * as temp from "temp";

// We load individual modules rather than the build module because the
// conversion code uses parts of salve that are not public.
import { ConversionParser, DatatypeProcessor, DefaultConversionWalker,
         NameGatherer, Renamer} from "../conversion";
import { ParameterParsingError, ValueValidationError } from "../datatypes";
import { fixPrototype } from "../tools";
import { version } from "../validate";

// tslint:disable:no-console no-non-null-assertion radix

temp.track();

const prog = path.basename(process.argv[1]);

//
// Safety harness
//

class Fatal extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "Fatal";
    this.message = msg;
    fixPrototype(this, Fatal);
 }
}

let args: any;
let terminating = false;
process.on("uncaughtException", (ex: any) => {
  // We don't want to handle exceptions that happen while we're terminating.
  if (terminating) {
    return;
  }

  terminating = true;
  if (ex instanceof Fatal) {
    process.stderr.write(`${prog}: ${ex.message}\n`);
    process.exit(1);
  }
  else {
    if (!args || !args.keep_temp) {
      temp.cleanup(); // We need to do this ourselves...
    }
    throw ex;
  }
});

//
//  Misc utilities
//

// Exception used to terminate the sax parser early.
class Found extends Error {
  constructor() {
    super();
    fixPrototype(this, Found);
  }
}

class Parser{
  constructor(public readonly saxParser: sax.SAXParser) {
    for (const name in this) {
      if (name.lastIndexOf("on", 0) === 0) {
        (this.saxParser as any)[name] = (this as any)[name].bind(this);
      }
    }
  }
}

class IncludeParser extends Parser {
  found: boolean;

  constructor(saxParser: sax.SAXParser) {
    super(saxParser);
    this.found = false;
  }

  onopentag(node: sax.QualifiedTag): void {
    // tslint:disable-next-line:no-http-string
    if (node.uri === "http://relaxng.org/ns/structure/1.0" &&
        (node.local === "include" || node.local === "externalRef")) {
      this.found = true;
      throw new Found();  // Stop early.
    }
  }
}

//
// The real logic begins here.
//

const parser = new ArgumentParser({
  addHelp: true,
  description: "Converts a simplified RNG file to a JavaScript file " +
    "that salve can use.",
});

parser.addArgument(["--version"], {
  help: "Show program's version number and exit.",
  action: "version",
  version,
} as any);

parser.addArgument(["--no-optimize-ids"], {
  help: "Do NOT optimize the identifiers used by references and definitions.",
  action: "storeTrue",
});

parser.addArgument(["--include-paths"], {
  help: "Include RNG node path information in the JavaScript file.",
  action: "storeTrue",
});

parser.addArgument(["--format-version"], {
  help: "Version number of the JavaScript format that the tool must produce.",
  type: Number,
  defaultValue: 3,
});

parser.addArgument(["--simplify-only"], {
  help: "Stop converting at the simplification stage.",
  action: "storeTrue",
});

parser.addArgument(["--simplified-input"], {
  help: "The input is as simplified RNG.",
  action: "storeTrue",
});

parser.addArgument(["--keep-temp"], {
  help: "Keep the temporary files around. Useful for diagnosis.",
  action: "storeTrue",
});

parser.addArgument(["-v", "--verbose"], {
  help: "Run verbosely.",
  action: "storeTrue",
});

parser.addArgument(["--timing"], {
  help: "Output timing information. Implies --verbose.",
  action: "storeTrue",
});

parser.addArgument(["--verbose-format"], {
  help: `Outputs a verbose version of the data, with actual class names \
instead of numbers. Implies --no-optimize-ids. This format is cannot \
be read by salve. It is meant for debugging purposes only.`,
  action: "storeTrue",
});

parser.addArgument(["--allow-incomplete-types"], {
  help: `Without this flag, the conversion process will stop upon \
encountering types that are not fully supported. Using this flag will \
allow the conversion to happen. Use --allow-incomplete-types=quiet to \
suppress all warnings about this.`,
});

parser.addArgument(["input_path"]);
parser.addArgument(["output_path"]);

args = parser.parseArgs();

if (args.timing) {
  args.verbose = true;
}

if (args.verbose_format) {
  args.no_optimize_ids = true;
}

if (args.format_version < 3) {
  throw new Fatal(`can't produce format version ${args.format_version}`);
}

let tempDir: string;
let startTime: number;
if (args.simplified_input) {
  convert(args.input_path);
}
else {
  if (args.verbose) {
    console.log("Validating RNG...");
    if (args.timing) {
      startTime = Date.now();
    }
  }

  // This is a bit of a hack. We want to make sure that the schema is a valid
  // RNG schema as per RNG specs. Running validation on our schema with a
  // schema that defines a valid schema sctructure does not trap import errors
  // or errors that are not expressible in a schema language. So we run jing
  // with our schema as the schema to use for validation and /dev/null as the
  // document to validate. This does catch errors but there is no clean way to
  // get jing to output only schema errors, hence what we have here.

  const child = spawn("jing", [args.input_path, "/dev/null"],
                      { stdio: ["ignore", "pipe", "ignore"] });

  let err = "";
  child.stdout.on("data", (data) => {
    err += data;
  });

  child.on("close", () => {
    // Remove everything that has to do with /dev/null to avoid confusing the
    // user.
    err = err.replace(/\/dev\/null(.|[\r\n])*/, "");
    // Earlier versions would output this error instead of the above.
    err = err.replace(/fatal: Premature end of file\.\s*/, "");
    if (args.verbose) {
      process.stderr.write(err);
    }

    // Search for an actual schema error.
    if (err.length !== 0) {
      let msg = "error in schema";
      if (!args.verbose) {
        msg += "; run with --verbose to see what the problem was";
      }
      throw new Fatal(msg);
    }
    if (args.timing) {
      console.log(`Validation delta: ${Date.now() - startTime}`);
    }
    simplify();
  });
}

interface Step {
  name: string;
  path: string;
  repeatWhen?: Function;
  repeat_no?: number;
}

let simplifyingStartTime: number;
function simplify(): void {
  // Grab the xsl files that form the simplification process, and store these
  // paths in ``steps``.
  if (args.verbose) {
    console.log("Simplifying...");
    if (args.timing) {
      simplifyingStartTime = Date.now();
    }
  }

  const libPath = path.resolve(__dirname, path.join("..",
                                                    "rng-simplification"));
  const stepRe = /^rng-simplification_step(\d*?).xsl$/;
  const stepFiles =
    fs.readdirSync(libPath).filter((file) => file.match(stepRe));

  // The filter step above ensures the regexp match.
  stepFiles.sort((a, b) => parseInt(a.match(stepRe)![1]) -
                 parseInt(b.match(stepRe)![1]));

  const steps = stepFiles.map((file) => {
    const ret: Step = { name: file, path: path.join(libPath, file) };
    if (file === "rng-simplification_step1.xsl") {
      ret.repeatWhen = (outPath: string): boolean => {
        // We want to check whether we need to run the
        // step again to include more files.
        const incParser = new IncludeParser(sax.parser(true, { xmlns: true }));
        const data = fs.readFileSync(outPath).toString();
        try {
          incParser.saxParser.write(data).close();
        }
        catch (ex) {
          if (!(ex instanceof Found)) {
            throw ex;
          }
        }

        return incParser.found;
      };
      ret.repeat_no = 0;
    }

    return ret;
  });

  tempDir = temp.mkdirSync({ prefix: "salve-convert" });

  if (args.keep_temp) {
    temp.track(false);
    console.log(`Temporary files in: ${tempDir}`);
  }

  executeStep(steps, 0, args.input_path, convert);
}

/**
 * @param steps The simplification steps.
 *
 * @param stepNo The index in ``steps`` of the step we are running.
 *
 * @param inPath Path of the input file for this step.
 *
 * @param after Callback to run after all steps.
 */
function executeStep(steps: Step[], stepNo: number, inPath: string,
                     after: Function): void {
  if (stepNo >= steps.length) {
    after(inPath);

    return;
  }

  const step = steps[stepNo];
  const outBase = `out${String((stepNo + 1)) +
(step.repeatWhen !== undefined ? `.${step.repeat_no! + 1}` : "")}.rng`;
  const outPath = path.join(tempDir, outBase);
  const xsltproc = spawn("xsltproc",
                         ["-o", outPath, "--stringparam",
                          "originalDir",
                          `${path.resolve(path.dirname(args.input_path))}/`,
                          step.path, inPath],
                         { stdio: "inherit" });
  xsltproc.on("exit", (status) => {
    if (status !== 0) {
      throw new Fatal(`xsltproc terminated with status: ${status}`);
    }

    if (!fs.existsSync(outPath)) {
      throw new Fatal(`xsltproc step ${stepNo} failed to create output`);
    }

    if (step.repeatWhen !== undefined) {
      if (step.repeatWhen(outPath)) {
        step.repeat_no = step.repeat_no! + 1;
        executeStep(steps, stepNo, outPath, after);

        return;
      }
    }

    executeStep(steps, stepNo + 1, outPath, after);
  });
}

/**
 * Meant to be used as the ``after`` call back for ``executeStep``. Performs the
 * conversion from RNG to JS.
 *
 * @param simplifiedPath Path pointing to the result of the simplification.
 */
function convert(simplifiedPath: string): void {
  if (args.timing) {
    console.log(`Simplification delta: ${Date.now() - simplifyingStartTime}`);
  }

  if (args.simplify_only) {
    const xmllint = spawn("xmllint", ["--format", "--output", args.output_path,
                                      simplifiedPath],
                          { stdio: "inherit" });
    xmllint.on("exit", process.exit.bind(undefined, 0));

    return;
  }

  let convStartTime;
  if (args.verbose) {
    console.log("Transforming RNG to JavaScript...");
    if (args.timing) {
      convStartTime = Date.now();
    }
  }

  const convParser = new ConversionParser(sax.parser(true, { xmlns: true }));
  let walker;
  switch (args.format_version) {
  case 3:
    walker = new DefaultConversionWalker(
      args.format_version, args.include_paths, args.verbose_format);
    break;
  default:
    throw new Error(`unknown version: ${args.format_version}`);
  }
  convParser.saxParser.write(
    fs.readFileSync(simplifiedPath).toString()).close();

  if (!args.no_optimize_ids) {
    // Gather names
    const g = new NameGatherer();
    g.walk(convParser.root);
    const names = g.names;

    // Now assign new names with shorter new names being assigned to those
    // original names that are most frequent.
    const sorted = Object.keys(names)
      .map((key) => ({ key: key, freq: names[key] }));
    // Yes, we want to sort in reverse order of frequency
    sorted.sort((a, b) => b.freq - a.freq);
    let id = 1;
    const newNames: Record<string, string> = {};
    sorted.forEach((elem) => {
      newNames[elem.key] = String(id++);
    });

    // Perform the renaming.
    const renamer = new Renamer(newNames);
    renamer.walk(convParser.root);
  }

  const typeChecker = new DatatypeProcessor();
  try {
    typeChecker.walk(convParser.root);
  }
  catch (ex) {
    if (ex instanceof ValueValidationError ||
        ex instanceof ParameterParsingError) {
      throw new Fatal(ex.message);
    }

    throw ex;
  }

  const stderr = process.stderr;
  if (typeChecker.warnings.length !== 0 &&
      args.allow_incomplete_types !== "quiet") {
    stderr.write(`${prog}: WARNING: the following incomplete types are \
used in the schema: `);
    stderr.write(Object.keys(typeChecker.incompleteTypesUsed).join(", "));
    stderr.write("\n");
    stderr.write(`${prog}: details follow\n`);

    typeChecker.warnings.forEach((x) => {
      stderr.write(`${prog}: ${x}\n`);
    });
    if (!args.allow_incomplete_types) {
      throw new Fatal("use --allow-incomplete-types to convert a file " +
                      "using these types");
    }
    else {
      stderr.write(`${prog}: allowing as requested\n`);
    }
  }

  walker.walk(convParser.root);
  fs.writeFileSync(args.output_path, walker.output.join(""));

  if (args.timing) {
    console.log(`Conversion delta: ${Date.now() - convStartTime!}`);
  }

  process.exit(0);
}
