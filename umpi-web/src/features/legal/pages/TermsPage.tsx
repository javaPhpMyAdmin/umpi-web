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
        <p className="text-text-secondary leading-relaxed">
          Al utilizar este sitio, aceptás cumplir con las siguientes condiciones:
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Responsabilidad en el Contenido
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los usuarios son responsables de la veracidad y legalidad de la información que publican en los avisos. Queda prohibido publicar contenido ofensivo, fraudulento o que infrinja derechos de terceros.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Publicaciones Destacadas
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los servicios o productos destacados están sujetos a un pago según las tarifas establecidas. El pago deberá realizarse según se indique en la plataforma para poder activar la visibilidad especial.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Privacidad
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Toda la información personal recolectada será tratada de acuerdo a nuestra Política de Privacidad, asegurando su confidencialidad y uso exclusivo para la gestión de su cuenta y publicaciones.
        </p>
      </section>
    </LegalPageLayout>
  )
}
