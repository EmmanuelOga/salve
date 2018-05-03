/**
 * Pattern and walker for RNG's ``interleave`` elements.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { NameResolver } from "../name_resolver";
import { union } from "../set";
import { BasePattern, cloneIfNeeded, CloneMap, EndResult, Event, EventSet,
         InternalFireEventResult, InternalWalker, isAttributeEvent,
         TwoSubpatterns } from "./base";

/**
 * A pattern for ``<interleave>``.
 */
export class Interleave extends TwoSubpatterns {
  protected _computeHasEmptyPattern(): boolean {
    return this.patA.hasEmptyPattern() && this.patB.hasEmptyPattern();
  }

  newWalker(nameResolver: NameResolver): InternalWalker<Interleave> {
    // tslint:disable-next-line:no-use-before-declare
    return new InterleaveWalker(this, nameResolver);
  }
}

/**
 * Walker for [[Interleave]].
 */
class InterleaveWalker extends InternalWalker<Interleave> {
  private ended: boolean;
  private readonly hasAttrs: boolean;
  private readonly walkerA: InternalWalker<BasePattern>;
  private readonly walkerB: InternalWalker<BasePattern>;
  private readonly nameResolver: NameResolver;
  canEndAttribute: boolean;
  canEnd: boolean;

  /**
   * @param el The pattern for which this walker was
   * created.
   *
   * @param resolver The name resolver that
   * can be used to convert namespace prefixes to namespaces.
   */
  constructor(walker: InterleaveWalker, memo: CloneMap);
  constructor(el: Interleave, nameResolver: NameResolver);
  constructor(elOrWalker: InterleaveWalker | Interleave,
              nameResolverOrMemo: NameResolver | CloneMap) {
    super(elOrWalker);
    if ((elOrWalker as Interleave).newWalker !== undefined) {
      const el = elOrWalker as Interleave;
      const nameResolver = nameResolverOrMemo as NameResolver;
      this.nameResolver = nameResolver;
      this.ended = false;
      this.hasAttrs = el.hasAttrs();
      this.walkerA = el.patA.newWalker(nameResolver);
      this.walkerB = el.patB.newWalker(nameResolver);
      this.canEndAttribute = !this.hasAttrs ||
        (this.walkerA.canEndAttribute && this.walkerB.canEndAttribute);
      this.canEnd = this.walkerA.canEnd && this.walkerB.canEnd;
    }
    else {
      const walker = elOrWalker as InterleaveWalker;
      const memo = nameResolverOrMemo as CloneMap;
      this.nameResolver = cloneIfNeeded(walker.nameResolver, memo);
      this.ended = walker.ended;
      this.hasAttrs = walker.hasAttrs;
      this.walkerA = walker.walkerA._clone(memo);
      this.walkerB = walker.walkerB._clone(memo);
      this.canEndAttribute = walker.canEndAttribute;
      this.canEnd = walker.canEnd;
    }
  }

  _clone(memo: CloneMap): this {
    return new InterleaveWalker(this, memo) as this;
  }

  possible(): EventSet {
    if (this.ended) {
      return new Set<Event>();
    }

    const ret = this.walkerA.possible();
    union(ret, this.walkerB.possible());

    return ret;
  }

  possibleAttributes(): EventSet {
    if (this.ended) {
      return new Set<Event>();
    }

    const ret = this.walkerA.possibleAttributes();
    union(ret, this.walkerB.possibleAttributes());

    return ret;
  }

  //
  // Interleave is very unusual among the patterns due to the fact that it
  // ignores subpattern order. For instance
  //
  // <interleave>A<interleave>B C</interleave></interleave>
  //
  // can match any permutation of the patterns A B and C. In particular, the
  // sequence B A C needs to be handled by the inner interleave, then by the
  // pattern for A and then by the inner interleave again.
  //
  // Moreover, while validating, it may match subpatterns only partially.
  // For instance:
  //
  // <interleave><group>A B</group>C</interleave>
  //
  // will match all permutations of A B C where A appears before B (so A B C, A
  // C B and C A B). The sequence A C B is particularly problematic as it means
  // matching the inner group, then matching C, then going back to the inner
  // group!
  //
  // When an interleave subpattern starts to match, we may not switch to
  // another subpattern until that subpattern is done. However, "done" here is
  // not synonymous with ``canEnd === true``. Looking again at the B A C
  // scenario above, we can switch to A when B is done but the inner level
  // interleave is itself not "done" because C has not matched yet.
  //
  // We work around the issue by counting the number of start tags and end tags
  // seen by a pattern. When they are equal we can switch away from from the
  // pattern to another one.
  //
  fireEvent(name: string, params: string[]): InternalFireEventResult {
    const ret = new InternalFireEventResult(false);
    const evIsAttributeEvent = isAttributeEvent(name);
    if (evIsAttributeEvent && !this.hasAttrs) {
      return ret;
    }

    // This is useful because it is possible for fireEvent to be called
    // after end() has been called.
    if (this.ended) {
      return ret;
    }

    const walkerA = this.walkerA;
    const walkerB = this.walkerB;

    const retA = walkerA.fireEvent(name, params);
    if (retA.matched) {
      if (evIsAttributeEvent) {
        this.canEndAttribute =
          walkerA.canEndAttribute && walkerB.canEndAttribute;
      }

      this.canEnd = walkerA.canEnd && walkerB.canEnd;

      // The constraints on interleave do not allow for two child patterns of
      // interleave to match. So if the first walker matched, the second
      // cannot. So we don't have to fireEvent on the second walker if the
      // first matched.
      return retA;
    }

    const retB = walkerB.fireEvent(name, params);
    if (retB.matched) {
      if (evIsAttributeEvent) {
        this.canEndAttribute =
          walkerA.canEndAttribute && walkerB.canEndAttribute;
      }

      this.canEnd = walkerA.canEnd && walkerB.canEnd;

      return retB;
    }

    return ret;
  }

  end(): EndResult {
    if (this.ended) {
      return false;
    }

    if (this.canEnd) {
      this.ended = true;

      return false;
    }

    const retA = this.walkerA.end();
    const retB = this.walkerB.end();

    if (retA) {
      return !retB ? retA : retA.concat(retB);
    }

    return retB;
  }

  endAttributes(): EndResult {
    if (this.ended || this.canEndAttribute) {
      return false;
    }

    const retA = this.walkerA.endAttributes();
    const retB = this.walkerB.endAttributes();

    if (retA) {
      return retB ? retA.concat(retB) : retA;
    }

    return retB;
  }
}

//  LocalWords:  RNG's MPL NG inA inB instantiateWalkers fireEvent retA retB
