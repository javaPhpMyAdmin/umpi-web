/**
 * TermsPage — Términos y Condiciones de uso de UMPI.
 * Copy is the client's literal legal text — do NOT translate or edit.
 */
import LegalPageLayout from '../components/LegalPageLayout'
import { LEGAL_VERSION_LABEL } from '../legalContent'

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Términos y Condiciones de uso de UMPI."
      updatedAt={`Última actualización: ${LEGAL_VERSION_LABEL}`}
    >
      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Identificación
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Bienvenido a UMPI. Al utilizar la aplicación o el sitio web de UMPI,
          aceptás estos Términos y Condiciones. Si no estás de acuerdo con
          ellos, no deberás utilizar la plataforma.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Objeto de UMPI
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI es una plataforma digital destinada a la publicación de anuncios
          clasificados de bienes y servicios.
        </p>
        <p className="text-text-secondary leading-relaxed">
          UMPI facilita el contacto entre usuarios, pero no compra, vende,
          distribuye ni garantiza los productos o servicios publicados.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Registro
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Para utilizar determinadas funciones será necesario crear una cuenta.
        </p>
        <p className="text-text-secondary leading-relaxed">
          El usuario declara que los datos suministrados son verdaderos y se
          compromete a mantenerlos actualizados.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Publicaciones
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Cada usuario es el único responsable de:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>La información publicada.</li>
          <li>Las fotografías.</li>
          <li>Los precios.</li>
          <li>La descripción.</li>
          <li>La legalidad del producto o servicio ofrecido.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          Está prohibido publicar:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Productos ilegales.</li>
          <li>Armas.</li>
          <li>Drogas.</li>
          <li>Contenido ofensivo.</li>
          <li>Material con derechos de autor sin autorización.</li>
          <li>Información falsa o engañosa.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          UMPI podrá eliminar publicaciones que incumplan estas normas.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Responsabilidad
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI no garantiza:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>La identidad de los usuarios.</li>
          <li>La calidad de los productos.</li>
          <li>El cumplimiento de las operaciones.</li>
          <li>La veracidad de las publicaciones.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          Toda negociación será responsabilidad exclusiva de las partes.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Pagos
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Las publicaciones destacadas y suscripciones podrán abonarse mediante
          Mercado Pago.
        </p>
        <p className="text-text-secondary leading-relaxed">
          Los pagos son procesados exclusivamente por Mercado Pago conforme a
          sus propios términos y políticas.
        </p>
        <p className="text-text-secondary leading-relaxed">
          UMPI no almacena datos de tarjetas de crédito o débito.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Suscripciones
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Las suscripciones podrán renovarse automáticamente mientras el usuario
          no solicite su cancelación.
        </p>
        <p className="text-text-secondary leading-relaxed">
          El usuario podrá cancelar la renovación desde su cuenta o mediante los
          canales de atención indicados.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Derecho de arrepentimiento
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Cuando corresponda conforme a la legislación argentina, el usuario
          podrá ejercer el derecho de revocar la contratación dentro del plazo
          legal.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Suspensión de cuentas
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI podrá suspender o eliminar cuentas que:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Incumplan estos términos.</li>
          <li>Publiquen contenido prohibido.</li>
          <li>Realicen actividades fraudulentas.</li>
          <li>Intenten vulnerar la seguridad de la plataforma.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Propiedad intelectual
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Todo el contenido propio de UMPI (marca, logotipo, diseño, software y
          textos) pertenece a UMPI.
        </p>
        <p className="text-text-secondary leading-relaxed">
          No podrá copiarse sin autorización.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Modificaciones
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI podrá modificar estos términos cuando resulte necesario.
        </p>
        <p className="text-text-secondary leading-relaxed">
          Las modificaciones serán publicadas dentro de la plataforma indicando
          su fecha de actualización.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Legislación aplicable
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Estos términos se regirán por las leyes de la República Argentina.
        </p>
      </section>
    </LegalPageLayout>
  )
}
